// pack:ignore

// This is the service worker for notify.moe.
// When installed, it will intercept all requests made by the browser
// and return a cache-first response.

//         request                 request
// Browser -------> Service Worker ------> notify.moe Server
//         <-------
//         response (cache)
//                                 <------
//                                 response (network)
//         <-------
//         response
//
// -> Diff cache with network response.

// By always returning cache first,
// we avoid latency problems on high latency connections like mobile
// networks. While the cache is being served, we start a real network
// request to the server to see if the resource changed. We compare the
// E-Tag of the cached and latest version of the resource. If the E-Tag
// of the current document changed, we send a message to the client
// that will cause the client to reload (diff) the page. It is not a real
// page reload as we will only calculate a DOM diff on the contents.
// If the style or script resources changed after being served, we need
// to force a real page reload.

// Promises
const RELOADS = new Map<string, Promise<Response>>()
const CACHEREFRESH = new Map<string, Promise<void>>()

// E-Tags that we served for a given URL
const ETAGS = new Map<string, string>()

// When these patterns are matched for the request URL, we exclude them from being
// served cache-first and instead serve them via a network request.
// Note that the service worker URL is automatically excluded from fetch events
// and therefore doesn't need to be added here.
const EXCLUDECACHE = new Set<string>([
	// API requests
	"/api/",

	// PayPal stuff
	"/paypal/",

	// List imports
	"/import/",

	// Infinite scrolling
	"/from/",

	// Chrome extension
	"chrome-extension",

	// Authorization paths /auth/ and /logout are not listed here because they are handled in a special way.
])


// MyServiceWorker is the process that controls all the tabs in a browser.
class MyServiceWorker {
	cache: MyCache

	constructor() {
		this.cache = new MyCache("v-5")

		self.addEventListener("install", (evt: InstallEvent) => evt.waitUntil(this.onInstall(evt)))
		self.addEventListener("activate", (evt: any) => evt.waitUntil(this.onActivate(evt)))
		self.addEventListener("fetch", (evt: FetchEvent) => evt.waitUntil(this.onRequest(evt)))
		self.addEventListener("message", (evt: any) => evt.waitUntil(this.onMessage(evt)))
		self.addEventListener("push", (evt: PushEvent) => evt.waitUntil(this.onPush(evt)))
		self.addEventListener("pushsubscriptionchange", (evt: any) => evt.waitUntil(this.onPushSubscriptionChange(evt)))
		self.addEventListener("notificationclick", (evt: NotificationEvent) => evt.waitUntil(this.onNotificationClick(evt)))
	}

	onInstall(evt: InstallEvent) {
		console.log("service worker install")

		return self.skipWaiting().then(() => {
			return this.installCache()
		})
	}

	onActivate(evt: any) {
		console.log("service worker activate")

		// Only keep current version of the cache and delete old caches
		let cacheWhitelist = [this.cache.version]

		let deleteOldCache = caches.keys().then(keyList => {
			return Promise.all(keyList.map(key => {
				if(cacheWhitelist.indexOf(key) === -1) {
					return caches.delete(key)
				}
			}))
		})

		// Immediate claim helps us gain control over a new client immediately
		let immediateClaim = self.clients.claim()

		return Promise.all([
			deleteOldCache,
			immediateClaim
		])
	}

	onRequest(evt: FetchEvent) {
		let request = evt.request as Request

		// If it's not a GET request, fetch it normally
		if(request.method !== "GET") {
			return evt.respondWith(fetch(request))
		}

		// Clear cache on authentication and fetch it normally
		if(request.url.includes("/auth/") || request.url.includes("/logout")) {
			return evt.respondWith(caches.delete(this.cache.version).then(() => fetch(request)))
		}

		// Exclude certain URLs from being cached
		for(let pattern of EXCLUDECACHE.keys()) {
			if(request.url.includes(pattern)) {
				return evt.respondWith(fetch(request))
			}
		}

		// If the request included the header "X-CacheOnly", return a cache-only response.
		// This is used in reloads to avoid generating a 2nd request after a cache refresh.
		if(request.headers.get("X-CacheOnly") === "true") {
			return evt.respondWith(this.fromCache(request))
		}

		// Start fetching the request
		let refresh = fetch(request).then(response => {
			let clone = response.clone()

			// Save the new version of the resource in the cache
			let cacheRefresh = this.cache.store(request, clone).catch(err => {
				console.error(err)
				// TODO: Tell client that the quota is exceeded (disk full).
			})

			CACHEREFRESH.set(request.url, cacheRefresh)

			// Force reload page if styles changed
			if(request.url.endsWith("/styles")) {
				let servedETag = ETAGS.get(request.url)
				let newETag = response.headers.get("ETag")
				console.log("/styles fetched", servedETag, newETag)

				if(servedETag && servedETag !== newETag) {
					cacheRefresh.then(async () => {
						console.log("tell client to reload style")
						let client = await MyClient.get(evt.clientId)
						client.reloadStyles()
					})
				}
			}

			return response
		})

		// Save in map
		RELOADS.set(request.url, refresh)

		// Forced reload
		let servedETag = undefined

		let onResponse = response => {
			servedETag = response.headers.get("ETag")
			ETAGS.set(request.url, servedETag)
			return response
		}

		if(request.headers.get("X-Reload") === "true") {
			return evt.respondWith(refresh.then(onResponse))
		}

		// Try to serve cache first and fall back to network response
		let networkOrCache = this.fromCache(request).then(onResponse).catch(error => {
			// console.log("Cache MISS:", request.url)
			return refresh
		})

		return evt.respondWith(networkOrCache)
	}

	async onMessage(evt: ServiceWorkerMessageEvent) {
		let message = JSON.parse(evt.data)
		let clientId = (evt.source as any).id
		let client = await MyClient.get(clientId)

		client.onMessage(message)
	}

	onPush(evt: PushEvent) {
		var payload = evt.data ? evt.data.json() : {}

		return self.registration.showNotification(payload.title, {
			body: payload.message,
			icon: payload.icon,
			image: payload.image,
			data: payload.link,
			badge: "https://notify.moe/brand/64.png"
		})
	}

	onPushSubscriptionChange(evt: any) {
		return self.registration.pushManager.subscribe(evt.oldSubscription.options)
		.then(async subscription => {
			console.log("send subscription to server...")

			let rawKey = subscription.getKey("p256dh")
			let key = rawKey ? btoa(String.fromCharCode.apply(null, new Uint8Array(rawKey))) : ""

			let rawSecret = subscription.getKey("auth")
			let secret = rawSecret ? btoa(String.fromCharCode.apply(null, new Uint8Array(rawSecret))) : ""

			let endpoint = subscription.endpoint

			let pushSubscription = {
				endpoint,
				p256dh: key,
				auth: secret,
				platform: navigator.platform,
				userAgent: navigator.userAgent,
				screen: {
					width: window.screen.width,
					height: window.screen.height
				}
			}

			let user = await fetch("/api/me", {
				credentials: "same-origin"
			}).then(response => response.json())

			return fetch("/api/pushsubscriptions/" + user.id + "/add", {
				method: "POST",
				credentials: "same-origin",
				body: JSON.stringify(pushSubscription)
			})
		})
	}

	onNotificationClick(evt: NotificationEvent) {
		let notification = evt.notification
		notification.close()

		return self.clients.matchAll().then(function(clientList) {
			// If we have a link, use that link to open a new window.
			let url = notification.data

			if(url) {
				return self.clients.openWindow(url)
			}

			// If there is at least one client, focus it.
			if(clientList.length > 0) {
				return (clientList[0] as WindowClient).focus()
			}

			// Otherwise open a new window
			return self.clients.openWindow("https://notify.moe")
		})
	}

	installCache() {
		// TODO: Implement a solution that caches resources with credentials: "same-origin"
		return Promise.resolve()

		// return caches.open(this.cache.version).then(cache => {
		// 	return cache.addAll([
		// 		"./",
		// 		"./scripts",
		// 		"https://fonts.gstatic.com/s/ubuntu/v11/4iCs6KVjbNBYlgoKfw7z.ttf"
		// 	])
		// })
	}

	fromCache(request) {
		return caches.open(this.cache.version).then(cache => {
			return cache.match(request).then(matching => {
				if(matching) {
					// console.log("Cache HIT:", request.url)
					return Promise.resolve(matching)
				}

				return Promise.reject("no-match")
			})
		})
	}
}

// MyCache is the cache used by the service worker.
class MyCache {
	version: string

	constructor(version: string) {
		this.version = version
	}

	store(request: RequestInfo, response: Response) {
		return caches.open(this.version).then(cache => {
			// This can fail if the disk space quota has been exceeded.
			return cache.put(request, response)
		})
	}
}

// MyClient represents a single tab in the browser.
class MyClient {
	client: ServiceWorkerClient

	constructor(client: ServiceWorkerClient) {
		this.client = client
	}

	onMessage(message: any) {
		switch(message.type) {
			case "loaded":
				this.onDOMContentLoaded(message.url)
				break
		}
	}

	postMessage(message: object) {
		this.client.postMessage(JSON.stringify(message))
	}

	// onDOMContentLoaded is called when the client sent this service worker
	// a message that the page has been loaded.
	onDOMContentLoaded(url: string) {
		let refresh = RELOADS.get(url)
		let servedETag = ETAGS.get(url)

		// If the user requests a sub-page we should prefetch the full page, too.
		if(url.includes("/_/") && !url.includes("/_/search/")) {
			var prefetch = true

			for(let pattern of EXCLUDECACHE.keys()) {
				if(url.includes(pattern)) {
					prefetch = false
					break
				}
			}

			if(prefetch) {
				this.prefetchFullPage(url)
			}
		}

		if(!refresh || !servedETag) {
			return Promise.resolve()
		}

		return refresh.then(async (response: Response) => {
			// When the actual network request was used by the client, response.bodyUsed is set.
			// In that case the client is already up to date and we don"t need to tell the client to do a refresh.
			if(response.bodyUsed) {
				return
			}

			// Get the ETag of the cached response we sent to the client earlier.
			let eTag = response.headers.get("ETag")

			// Update ETag
			ETAGS.set(url, eTag)

			// If the ETag changed, we need to do a reload.
			if(eTag !== servedETag) {
				return this.reloadContent(url)
			}

			// Do nothing
			return Promise.resolve()
		})
	}

	prefetchFullPage(url: string) {
		let fullPage = new Request(url.replace("/_/", "/"))

		let fullPageRefresh = fetch(fullPage, {
			credentials: "same-origin"
		}).then(response => {
			// Save the new version of the resource in the cache
			let cacheRefresh = caches.open(serviceWorker.cache.version).then(cache => {
				return cache.put(fullPage, response)
			})

			CACHEREFRESH.set(fullPage.url, cacheRefresh)
			return response
		})

		// Save in map
		RELOADS.set(fullPage.url, fullPageRefresh)
	}

	async reloadContent(url: string) {
		let cacheRefresh = CACHEREFRESH.get(url)

		if(cacheRefresh) {
			await cacheRefresh
		}

		return this.postMessage({
			type: "new content",
			url
		})
	}

	async reloadPage(url: string) {
		let networkFetch = RELOADS.get(url.replace("/_/", "/"))

		if(networkFetch) {
			await networkFetch
		}

		return this.postMessage({
			type: "reload page",
			url
		})
	}

	reloadStyles() {
		return this.postMessage({
			type: "reload styles"
		})
	}

	// Map of clients
	static idToClient = new Map<string, MyClient>()

	static async get(id: string): Promise<MyClient> {
		let client = MyClient.idToClient.get(id)

		if(!client) {
			client = new MyClient(await self.clients.get(id))
			MyClient.idToClient.set(id, client)
		}

		return client
	}
}

const serviceWorker = new MyServiceWorker()

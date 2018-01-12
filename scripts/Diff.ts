export class Diff {
	static persistentClasses = new Set<string>()
	static persistentAttributes = new Set<string>()

	// Reuse container for diffs to avoid memory allocation
	static container: HTMLElement
	static rootContainer: HTMLElement

	// innerHTML will diff the element with the given HTML string and apply DOM mutations.
	static innerHTML(aRoot: HTMLElement, html: string): Promise<void> {
		if(!Diff.container) {
			Diff.container = document.createElement("main")
		}

		Diff.container.innerHTML = html

		return new Promise((resolve, reject) => {
			window.requestAnimationFrame(() => {
				Diff.childNodes(aRoot, Diff.container)
				resolve()
			})
		})
	}

	// root will diff the document root element with the given HTML string and apply DOM mutations.
	static root(aRoot: HTMLElement, html: string) {
		return new Promise((resolve, reject) => {
			if(!Diff.rootContainer) {
				Diff.rootContainer = document.createElement("html")
			}

			Diff.rootContainer.innerHTML = html.replace("<!DOCTYPE html>", "")

			window.requestAnimationFrame(() => {
				Diff.childNodes(aRoot.getElementsByTagName("body")[0], Diff.rootContainer.getElementsByTagName("body")[0])
				resolve()
			})
		})
	}

	// childNodes diffs the child nodes of 2 given elements and applies DOM mutations.
	static childNodes(aRoot: Node, bRoot: Node) {
		let aChild = [...aRoot.childNodes]
		let bChild = [...bRoot.childNodes]
		let numNodes = Math.max(aChild.length, bChild.length)

		for(let i = 0; i < numNodes; i++) {
			let a = aChild[i]

			// Remove nodes at the end of a that do not exist in b
			if(i >= bChild.length) {
				aRoot.removeChild(a)
				continue
			}

			let b = bChild[i]

			// If a doesn't have that many nodes, simply append at the end of a
			if(i >= aChild.length) {
				aRoot.appendChild(b)
				continue
			}

			// If it's a completely different HTML tag or node type, replace it
			if(a.nodeName !== b.nodeName || a.nodeType !== b.nodeType) {
				aRoot.replaceChild(b, a)
				continue
			}

			// Text node:
			// We don't need to check for b to be a text node as well because
			// we eliminated different node types in the previous condition.
			if(a.nodeType === Node.TEXT_NODE) {
				a.textContent = b.textContent
				continue
			}

			// HTML element:
			if(a.nodeType === Node.ELEMENT_NODE) {
				let elemA = a as HTMLElement
				let elemB = b as HTMLElement

				let removeAttributes: Attr[] = []

				for(let x = 0; x < elemA.attributes.length; x++) {
					let attrib = elemA.attributes[x]

					if(attrib.specified) {
						if(!elemB.hasAttribute(attrib.name) && !Diff.persistentAttributes.has(attrib.name)) {
							removeAttributes.push(attrib)
						}
					}
				}

				for(let attr of removeAttributes) {
					elemA.removeAttributeNode(attr)
				}

				for(let x = 0; x < elemB.attributes.length; x++) {
					let attrib = elemB.attributes[x]

					if(!attrib.specified) {
						continue
					}

					// If the attribute value is exactly the same, skip this attribute.
					if(elemA.getAttribute(attrib.name) === attrib.value) {
						continue
					}

					if(attrib.name === "class") {
						let classesA = elemA.classList
						let classesB = elemB.classList
						let removeClasses: string[] = []

						for(let className of classesA) {
							if(!classesB.contains(className) && !Diff.persistentClasses.has(className)) {
								removeClasses.push(className)
							}
						}

						for(let className of removeClasses) {
							classesA.remove(className)
						}

						for(let className of classesB) {
							if(!classesA.contains(className)) {
								classesA.add(className)
							}
						}

						continue
					}

					elemA.setAttribute(attrib.name, attrib.value)
				}

				// Special case: Apply state of input elements
				if(elemA !== document.activeElement && elemA instanceof HTMLInputElement && elemB instanceof HTMLInputElement) {
					elemA.value = elemB.value
				}
			}

			Diff.childNodes(a, b)
		}
	}
}
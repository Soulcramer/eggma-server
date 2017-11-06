package main

import (
	"github.com/aerogo/aero"
	"github.com/soulcramer/eggma.fr/components/js"
	"io/ioutil"
)

// configureAssets adds all the routes used for media assets.
func configureAssets(app *aero.Application) {
	// Script bundle
	scriptBundle := js.Bundle()

	// Service worker
	serviceWorkerBytes, err := ioutil.ReadFile("sw/service-worker.js")
	serviceWorker := string(serviceWorkerBytes)

	if err != nil {
		panic("Couldn't load service worker")
	}

	app.Get("/scripts", func(ctx *aero.Context) string {
		return ctx.JavaScript(scriptBundle)
	})

	app.Get("/scripts.js", func(ctx *aero.Context) string {
		return ctx.JavaScript(scriptBundle)
	})

	app.Get("/service-worker", func(ctx *aero.Context) string {
		return ctx.JavaScript(serviceWorker)
	})

	// Favicon
	app.Get("/favicon.ico", func(ctx *aero.Context) string {
		return ctx.TryWebP("images/brand/64", ".png")
	})

	// For benchmarks
	app.Get("/hello", func(ctx *aero.Context) string {
		return ctx.Text("Hello World")
	})
}

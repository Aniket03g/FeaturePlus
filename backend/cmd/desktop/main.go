// Command featureplus runs FeaturePlus as a desktop application.
//
// The window is a webview pointed at the ordinary FeaturePlus server, started
// in this same process on loopback. That is the whole design: there is one
// server, one API and one frontend, and the desktop build is a window around
// them rather than a second implementation.
//
// In particular this deliberately does not use Wails' Go↔JavaScript bindings.
// Bindings would mean the desktop app talked to Go directly while the browser
// talked to /api/v1, and every feature would then have to be built twice and
// kept in step. Everything here goes over HTTP, exactly as the browser does,
// so a screen that works in one works in the other.
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"

	"github.com/FeaturePlus/backend/app"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func main() {
	// Desktop configuration binds 127.0.0.1:0, so the operating system picks a
	// free port and nothing outside this machine can reach the app. It also
	// puts the database in the per-user data directory, since the folder the
	// application is installed into is usually not writable.
	application, err := app.New(app.DefaultDesktopConfig())
	if err != nil {
		fatal("FeaturePlus could not start", err)
	}
	defer application.Close()

	// Bind before the window opens, so the address is known by the time the
	// webview asks for its first page. Serving then happens in the background.
	if _, err := application.Listen(); err != nil {
		fatal("FeaturePlus could not open its local port", err)
	}

	go func() {
		if err := application.Serve(); err != nil {
			log.WithError(err).Error("The local server stopped")
		}
	}()

	base := application.URL()
	target := base + "/app/"
	log.WithField("url", target).Info("Desktop window starting")

	// ctx is handed over when Wails starts, and is what the menu items need to
	// talk to the window. It is written once, before any menu item can run.
	var ctx context.Context

	err = wails.Run(&options.App{
		Title:     "FeaturePlus",
		Width:     1400,
		Height:    900,
		MinWidth:  900,
		MinHeight: 600,

		// The window is sent to the local server with a redirect rather than
		// having Wails serve assets over its own wails:// scheme. Landing on a
		// real http origin keeps cookies, and so sign-in, behaving exactly as
		// they do in a browser: the session cookie is HttpOnly and
		// origin-bound, and a custom scheme is where that quietly stops
		// working.
		AssetServer: &assetserver.Options{
			Handler: http.RedirectHandler(target, http.StatusTemporaryRedirect),
		},

		Menu: buildMenu(&ctx, base),

		OnStartup: func(startupCtx context.Context) {
			ctx = startupCtx
		},

		OnShutdown: func(context.Context) {
			// Close explicitly. SQLite holds a lock on the user's file for the
			// life of the process, and on a desktop application that means the
			// file stays locked after the window has gone.
			application.Close()
		},
	})
	if err != nil {
		fatal("FeaturePlus could not open its window", err)
	}
}

// buildMenu is a small native menu.
//
// Reload and Open in browser are both here because this is a webview around a
// local server: a stuck page is fixed by reloading it, and the same URL works
// in a real browser, which is the quickest way to use the developer tools
// against it.
func buildMenu(ctx *context.Context, base string) *menu.Menu {
	root := menu.NewMenu()

	file := root.AddSubmenu("File")
	file.AddText("Open in browser", nil, func(*menu.CallbackData) {
		if *ctx != nil {
			runtime.BrowserOpenURL(*ctx, base+"/app/")
		}
	})
	file.AddSeparator()
	file.AddText("Quit", keys.CmdOrCtrl("q"), func(*menu.CallbackData) {
		if *ctx != nil {
			runtime.Quit(*ctx)
		}
	})

	view := root.AddSubmenu("View")
	view.AddText("Reload", keys.CmdOrCtrl("r"), func(*menu.CallbackData) {
		if *ctx != nil {
			runtime.WindowReload(*ctx)
		}
	})

	return root
}

// fatal reports a startup failure and stops.
//
// A desktop application has no terminal to print to, so the message goes to
// the log file as well as to stderr — otherwise a failed launch looks like
// nothing happening at all.
func fatal(message string, err error) {
	log.WithError(err).Error(message)
	fmt.Fprintln(os.Stderr, message+": "+err.Error())
	os.Exit(1)
}

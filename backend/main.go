// Command featureplus-server runs FeaturePlus as a web server.
//
// Everything it does lives in the app package, which is shared with the desktop
// build. This file exists only to choose the server configuration and start it.
package main

import (
	"os"
	"os/signal"
	"syscall"

	"github.com/FeaturePlus/backend/app"
	"github.com/FeaturePlus/backend/internal/log"
)

func main() {
	application, err := app.New(app.DefaultServerConfig())
	if err != nil {
		log.WithError(err).Fatal("Failed to start FeaturePlus")
	}
	defer application.Close()

	// Shut down cleanly on Ctrl-C or a container stop, so in-flight requests
	// finish and SQLite is closed properly.
	go func() {
		signals := make(chan os.Signal, 1)
		signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
		sig := <-signals
		log.WithField("signal", sig.String()).Info("Shutting down")
		application.Close()
	}()

	if err := application.Serve(); err != nil {
		log.WithError(err).Fatal("Failed to start server")
	}
}

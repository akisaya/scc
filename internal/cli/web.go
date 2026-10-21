package cli

import (
	"errors"
	"flag"
	"io"

	"scc/internal/config"
	"scc/internal/web"
)

func webCmd(args []string) error {
	fs := flag.NewFlagSet("web", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	addr := fs.String("addr", "", "listen address, e.g. 127.0.0.1:8080")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return errors.New("usage: scc web [-addr host:port]")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if *addr != "" {
		cfg.Listen = *addr
	}
	if cfg.Listen == "" {
		cfg.Listen = "127.0.0.1:8080"
	}
	return web.Serve(cfg)
}

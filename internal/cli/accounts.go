package cli

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"text/tabwriter"

	"scc/internal/config"
)

func accountsCmd(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: scc accounts <add|list|rm>")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	switch args[0] {
	case "add":
		return accountsAdd(cfg, args[1:])
	case "list", "ls":
		return accountsList(cfg)
	case "rm", "remove":
		if len(args) < 2 {
			return errors.New("usage: scc accounts rm <name>")
		}
		if !cfg.Remove(args[1]) {
			return fmt.Errorf("account %q not found", args[1])
		}
		if err := cfg.Save(); err != nil {
			return err
		}
		fmt.Printf("removed account %q\n", args[1])
		return nil
	default:
		return fmt.Errorf("unknown subcommand %q", args[0])
	}
}

func accountsAdd(cfg *config.Config, args []string) error {
	fs := flag.NewFlagSet("accounts add", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	endpoint := fs.String("endpoint", "", "S3 endpoint URL")
	region := fs.String("region", "us-east-1", "region")
	ak := fs.String("access-key", "", "access key id")
	sk := fs.String("secret-key", "", "secret access key")
	pathStyle := fs.Bool("path-style", false, "use path-style addressing")
	defBucket := fs.String("default-bucket", "", "default bucket")
	// Allow "accounts add name -flags ..." as well as flags first, since flag
	// parsing stops at the first positional argument.
	name := ""
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		name, args = args[0], args[1:]
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if name == "" {
		if fs.NArg() != 1 {
			return errors.New("usage: scc accounts add <name> [flags]")
		}
		name = fs.Arg(0)
	}
	if *ak == "" || *sk == "" {
		return errors.New("-access-key and -secret-key are required (env:VAR is allowed)")
	}
	if err := config.ValidName(name); err != nil {
		return err
	}
	// Every self-hosted S3 needs path-style; only real AWS wants virtual-host.
	explicit := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "path-style" {
			explicit = true
		}
	})
	usePath := *pathStyle || (!explicit && *endpoint != "")

	a := config.Account{
		Name:          name,
		Endpoint:      strings.TrimRight(*endpoint, "/"),
		Region:        *region,
		AccessKey:     *ak,
		SecretKey:     *sk,
		PathStyle:     usePath,
		DefaultBucket: *defBucket,
	}
	cfg.Upsert(a)
	if err := cfg.Save(); err != nil {
		return err
	}
	fmt.Printf("saved account %q to %s\n", a.Name, config.Path())
	return nil
}

func accountsList(cfg *config.Config) error {
	if len(cfg.Accounts) == 0 {
		fmt.Printf("no accounts yet, add one:\n  scc accounts add local -endpoint http://127.0.0.1:9000 -access-key .. -secret-key ..\n")
		return nil
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(w, "NAME\tENDPOINT\tREGION\tPATH_STYLE\tDEFAULT BUCKET\tACCESS KEY")
	for _, a := range cfg.Accounts {
		ep := a.Endpoint
		if ep == "" {
			ep = "aws"
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%t\t%s\t%s\n", a.Name, ep, a.Region, a.PathStyle, a.DefaultBucket, a.AccessKey)
	}
	w.Flush()
	fmt.Printf("\nconfig: %s\n", config.Path())
	return nil
}

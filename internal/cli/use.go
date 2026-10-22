package cli

import (
	"errors"
	"fmt"

	"github.com/akisaya/scc/internal/config"
)

// useCmd switches the bucket an account's paths resolve against.
// "scc use acct:/bucket" sets it, "scc use acct:" clears it.
func useCmd(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: scc use <account>:/bucket   (no bucket clears the default)")
	}
	t, err := parseTarget(args[0])
	if err != nil {
		return err
	}
	if t.key != "" {
		return fmt.Errorf("expected <account>:/bucket, got %q", args[0])
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if err := cfg.SetDefaultBucket(t.acct, t.bucket); err != nil {
		return err
	}
	if err := cfg.Save(); err != nil {
		return err
	}
	if t.bucket == "" {
		fmt.Printf("cleared default bucket for %q\n", t.acct)
		return nil
	}
	fmt.Printf("default bucket for %q is now %q\n", t.acct, t.bucket)
	return nil
}

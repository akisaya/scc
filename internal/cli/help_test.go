package cli

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestCommandHelpNeedsNoConfiguration(t *testing.T) {
	t.Setenv("SCC_CONFIG", t.TempDir()) // a directory cannot be parsed as configuration
	for _, args := range [][]string{
		{"help", "get"}, {"get", "--help"}, {"ls", "-h"}, {"help", "rm"}, {"rm", "--help"},
		{"help", "put"}, {"put", "--help"},
		{"help", "accounts", "add"}, {"accounts", "add", "--help"}, {"web", "--help"},
		{"cat", "--help"}, {"help", "list"}, {"help", "acct", "ls"}, {"use", "--help"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			out, stderr, err := runCLI(t, args...)
			if err != nil || !strings.Contains(out, "usage: scc ") || stderr != "" {
				t.Fatalf("help = %q, %q, %v", out, stderr, err)
			}
		})
	}
}

func TestHelpFlagAsCredentialValue(t *testing.T) {
	t.Setenv("SCC_CONFIG", filepath.Join(t.TempDir(), "config.yaml"))
	out, _, err := runCLI(t, "accounts", "add", "test", "-access-key", "k", "-secret-key", "--help")
	if err != nil || !strings.Contains(out, "saved account") {
		t.Fatalf("flag value treated as help: %q, %v", out, err)
	}
}

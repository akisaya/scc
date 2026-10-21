package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveLoadRoundTrip(t *testing.T) {
	t.Setenv("SCC_CONFIG", filepath.Join(t.TempDir(), "nested", "config.yaml"))

	c, err := Load()
	if err != nil {
		t.Fatalf("load missing file: %v", err)
	}
	if c.Listen != "127.0.0.1:8080" {
		t.Errorf("default listen = %q", c.Listen)
	}
	c.Upsert(Account{Name: "a", Endpoint: "http://x", AccessKey: "env:AK", SecretKey: "sk", DefaultBucket: "data"})
	c.Upsert(Account{Name: "b", Endpoint: "http://b"})
	c.Upsert(Account{Name: "a", Endpoint: "http://y", AccessKey: "env:AK", SecretKey: "sk2"}) // update in place
	if len(c.Accounts) != 2 {
		t.Fatalf("upsert added a duplicate: %d accounts", len(c.Accounts))
	}
	if err := c.Save(); err != nil {
		t.Fatalf("save: %v", err)
	}

	fi, err := os.Stat(Path())
	if err != nil {
		t.Fatal(err)
	}
	if perm := fi.Mode().Perm(); perm != 0o600 {
		t.Errorf("config mode = %o, want 600", perm)
	}

	c2, err := Load()
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	t.Setenv("AK", "resolved")
	a, err := c2.Account("a")
	if err != nil {
		t.Fatal(err)
	}
	if a.AccessKey != "resolved" {
		t.Errorf("env: indirection = %q", a.AccessKey)
	}
	if a.Endpoint != "http://y" || a.SecretKey != "sk2" {
		t.Errorf("account = %+v", *a)
	}
	if _, err := c2.Account("missing"); err == nil {
		t.Error("expected error for unknown account")
	}
	c2.Remove("a")
	if c2.Remove("a") {
		t.Error("second remove should report false")
	}
	if len(c2.Accounts) != 1 {
		t.Errorf("accounts left after remove: %d", len(c2.Accounts))
	}
}

func TestPath(t *testing.T) {
	t.Setenv("SCC_CONFIG", "/tmp/custom.yaml")
	if got := Path(); got != "/tmp/custom.yaml" {
		t.Errorf("SCC_CONFIG not honoured: %q", got)
	}
	t.Setenv("SCC_CONFIG", "")
	t.Setenv("XDG_CONFIG_HOME", "/tmp/xdg")
	if got := Path(); got != "/tmp/xdg/scc/config.yaml" {
		t.Errorf("XDG_CONFIG_HOME not honoured: %q", got)
	}
	t.Setenv("XDG_CONFIG_HOME", "")
	want := filepath.Join(mustHome(t), ".config", "scc", "config.yaml")
	if got := Path(); got != want {
		t.Errorf("default path = %q, want %q", got, want)
	}
}

func mustHome(t *testing.T) string {
	t.Helper()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home dir")
	}
	return home
}

func TestValidName(t *testing.T) {
	ok := []string{"minio", "r2", "my-bucket", "a_b.c", "A1", "x.y-z_1"}
	for _, n := range ok {
		if err := ValidName(n); err != nil {
			t.Errorf("ValidName(%q) = %v, want nil", n, err)
		}
	}
	bad := []string{"", ".", "..", "a/b", "a b", "a:b", "a@b", "中文", "café",
		strings.Repeat("x", 65)}
	for _, n := range bad {
		if err := ValidName(n); err == nil {
			t.Errorf("ValidName(%q) = nil, want error", n)
		}
	}
}

func TestExists(t *testing.T) {
	c := &Config{}
	c.Upsert(Account{Name: "a"})
	if !c.Exists("a") {
		t.Error("Exists(a) = false")
	}
	if c.Exists("b") {
		t.Error("Exists(b) = true")
	}
}

func TestSetDefaultBucket(t *testing.T) {
	c := &Config{}
	c.Upsert(Account{Name: "a"})
	if err := c.SetDefaultBucket("a", "data"); err != nil {
		t.Fatal(err)
	}
	if c.Accounts[0].DefaultBucket != "data" {
		t.Errorf("default = %q", c.Accounts[0].DefaultBucket)
	}
	if err := c.SetDefaultBucket("a", ""); err != nil {
		t.Fatal(err)
	}
	if c.Accounts[0].DefaultBucket != "" {
		t.Errorf("clear failed: %q", c.Accounts[0].DefaultBucket)
	}
	if err := c.SetDefaultBucket("ghost", "data"); err == nil {
		t.Error("expected error for unknown account")
	}
}

func TestExpand(t *testing.T) {
	t.Setenv("SCC_TEST_SECRET", "sccr3t")
	if got := expand("env:SCC_TEST_SECRET"); got != "sccr3t" {
		t.Errorf("expand = %q", got)
	}
	if got := expand("plain"); got != "plain" {
		t.Errorf("expand plain = %q", got)
	}
}

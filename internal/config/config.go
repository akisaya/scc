package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

type Account struct {
	Name          string `yaml:"name"`
	Endpoint      string `yaml:"endpoint"`
	Region        string `yaml:"region"`
	AccessKey     string `yaml:"access_key"`
	SecretKey     string `yaml:"secret_key"`
	PathStyle     bool   `yaml:"path_style"`
	DefaultBucket string `yaml:"default_bucket"`
}

type Config struct {
	Listen   string    `yaml:"listen"`
	Token    string    `yaml:"token"`
	Accounts []Account `yaml:"accounts"`

	path string
}

// Path is $SCC_CONFIG, else $XDG_CONFIG_HOME/scc/config.yaml, else ~/.config/scc/config.yaml.
func Path() string {
	if p := os.Getenv("SCC_CONFIG"); p != "" {
		return p
	}
	dir := os.Getenv("XDG_CONFIG_HOME")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "config.yaml"
		}
		dir = filepath.Join(home, ".config")
	}
	return filepath.Join(dir, "scc", "config.yaml")
}

func Load() (*Config, error) {
	p := Path()
	c := &Config{path: p, Listen: "127.0.0.1:8080"}
	b, err := os.ReadFile(p)
	if errors.Is(err, fs.ErrNotExist) {
		return c, nil
	}
	if err != nil {
		return nil, err
	}
	if err := yaml.Unmarshal(b, c); err != nil {
		return nil, fmt.Errorf("parse %s: %w", p, err)
	}
	c.path = p
	return c, nil
}

func (c *Config) Save() error {
	if err := os.MkdirAll(filepath.Dir(c.path), 0o700); err != nil {
		return err
	}
	b, err := yaml.Marshal(c)
	if err != nil {
		return err
	}
	return os.WriteFile(c.path, b, 0o600)
}

// ValidName checks that an account name is safe to use in CLI paths, URLs and
// the web UI's #/account/bucket/prefix route.
func ValidName(name string) error {
	if name == "" {
		return errors.New("account name must not be empty")
	}
	if len(name) > 64 {
		return fmt.Errorf("account name %q is longer than 64 characters", name)
	}
	if name == "." || name == ".." {
		return fmt.Errorf("account name %q is not allowed", name)
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '-', r == '_', r == '.':
		default:
			return fmt.Errorf("account name %q may only contain letters, digits, '-', '_' and '.'", name)
		}
	}
	return nil
}

// Account returns a copy with env: indirections resolved, so secrets can stay out of the file.
func (c *Config) Account(name string) (*Account, error) {
	for _, a := range c.Accounts {
		if a.Name == name {
			a.AccessKey = expand(a.AccessKey)
			a.SecretKey = expand(a.SecretKey)
			return &a, nil
		}
	}
	return nil, fmt.Errorf("account %q not found (see: scc accounts list)", name)
}

func (c *Config) Upsert(a Account) {
	for i := range c.Accounts {
		if c.Accounts[i].Name == a.Name {
			c.Accounts[i] = a
			return
		}
	}
	c.Accounts = append(c.Accounts, a)
}

func (c *Config) Remove(name string) bool {
	for i := range c.Accounts {
		if c.Accounts[i].Name == name {
			c.Accounts = append(c.Accounts[:i], c.Accounts[i+1:]...)
			return true
		}
	}
	return false
}

func expand(s string) string {
	if v, ok := strings.CutPrefix(s, "env:"); ok {
		return os.Getenv(v)
	}
	return s
}

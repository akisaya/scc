package cli

import (
	"context"
	"fmt"
	"strings"

	"scc/internal/config"
	"scc/internal/s3x"
)

const usageText = `scc - a small S3-compatible file browser

usage: scc <command> [args]

commands:
  accounts add <name> [flags]   add or update an account
  accounts list                 list accounts (secrets never printed)
  accounts rm <name>            remove an account
  use <acct>:/bucket            switch the bucket <acct>: resolves against
                                (omit the bucket to clear it)
  ls <acct>:[/bucket[/prefix]] [-r]
                                list buckets, objects or a directory
  buckets <acct>                list buckets (use when a default bucket is set)
  cat <acct>:/bucket/key        write an object to stdout
  cp [-r] <src> <dst>           copy between local and S3, or S3 to S3
  rm [-r] <acct>:/bucket/key    delete an object or a prefix
  mb <acct>:/bucket             create a bucket
  rb <acct>:/bucket             delete an empty bucket
  web [-addr host:port]         start the browser UI (default from config listen)

accounts add flags:
  -endpoint       S3 endpoint URL (omit for AWS)
  -region         region (default us-east-1)
  -access-key     access key id, or env:VAR
  -secret-key     secret access key, or env:VAR
  -path-style     use path-style addressing (default when -endpoint is set)
  -default-bucket default bucket used by "acct:" without a bucket

object paths are <account>:/bucket/key when no default bucket is set. Once an
account has one, every path is relative to it: "acct:" is its root and
"acct:/dir/file" is inside it. Switch with "scc use acct:/bucket".

account names use letters, digits, '-', '_' and '.' (max 64 characters)

config file: $SCC_CONFIG, else $XDG_CONFIG_HOME/scc/config.yaml,
             else ~/.config/scc/config.yaml
`

func Run(args []string) error {
	if len(args) == 0 {
		fmt.Print(usageText)
		return nil
	}
	switch cmd, rest := args[0], args[1:]; cmd {
	case "accounts", "acct":
		return accountsCmd(rest)
	case "use":
		return useCmd(rest)
	case "ls", "list":
		return lsCmd(rest)
	case "buckets":
		return bucketsCmd(rest)
	case "cat":
		return catCmd(rest)
	case "cp":
		return cpCmd(rest)
	case "rm":
		return rmCmd(rest)
	case "mb":
		return mbCmd(rest)
	case "rb":
		return rbCmd(rest)
	case "web":
		return webCmd(rest)
	case "help", "-h", "--help":
		fmt.Print(usageText)
		return nil
	default:
		return fmt.Errorf("unknown command %q (try: scc help)", cmd)
	}
}

// target is an "<account>:/bucket/key" reference. Empty bucket means "account root".
type target struct {
	acct   string
	bucket string
	key    string
	dir    bool // the path was written with a trailing slash
}

func parseTarget(s string) (target, error) {
	acct, path, ok := strings.Cut(s, ":")
	if !ok || acct == "" {
		return target{}, fmt.Errorf("expected <account>:/bucket/key, got %q", s)
	}
	path = strings.TrimPrefix(path, "/")
	dir := strings.HasSuffix(path, "/")
	bucket, key, _ := strings.Cut(path, "/")
	return target{acct: acct, bucket: bucket, key: key, dir: dir}, nil
}

func isS3(s string) bool {
	i := strings.Index(s, ":")
	return i > 0 && !strings.Contains(s[:i], "/")
}

// clientFor resolves an account from the config file.
func clientFor(name string) (*s3x.Client, *config.Account, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, nil, err
	}
	acct, err := cfg.Account(name)
	if err != nil {
		return nil, nil, err
	}
	c, err := s3x.Open(*acct)
	if err != nil {
		return nil, nil, err
	}
	return c, acct, nil
}

// withTarget opens the client and resolves the account's default bucket when none was given.
func withTarget(s string) (*s3x.Client, target, error) {
	t, err := parseTarget(s)
	if err != nil {
		return nil, t, err
	}
	c, acct, err := clientFor(t.acct)
	if err != nil {
		return nil, t, err
	}
	t = resolveTarget(t, acct.DefaultBucket)
	return c, t, nil
}

// resolveTarget applies the account's default bucket: when one is configured every
// path is relative to it, so "acct:/cb_test/" is a folder there, never a bucket.
// Without a default bucket the first segment is the bucket, as written.
func resolveTarget(t target, def string) target {
	if def == "" {
		return t
	}
	key := t.bucket
	if t.key != "" {
		key += "/" + t.key
	} else if t.dir {
		key += "/"
	}
	t.key = key
	t.bucket = def
	return t
}

// bucketTarget handles commands that must name a bucket outright (mb, rb), so the
// default-bucket remapping can never turn "acct:/newname" into the default bucket.
func bucketTarget(s string) (*s3x.Client, string, error) {
	t, err := parseTarget(s)
	if err != nil {
		return nil, "", err
	}
	if t.bucket == "" || t.key != "" {
		return nil, "", fmt.Errorf("expected <account>:/bucket, got %q", s)
	}
	c, _, err := clientFor(t.acct)
	return c, t.bucket, err
}

func ctx() context.Context { return context.Background() }

func humanSize(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%dB", n)
	}
	div, exp := int64(unit), 0
	for v := n / unit; v >= unit; v /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f%c", float64(n)/float64(div), "KMGTPE"[exp])
}

package cli

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/akisaya/scc/internal/s3x"
)

func lsCmd(args []string) error {
	fs := flag.NewFlagSet("ls", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	recursive := fs.Bool("r", false, "list recursively")
	prefixMode := fs.Bool("p", false, "treat the path as a raw S3 prefix")
	limit := fs.Int("n", -1, "max entries to print: -1 = all when piped, 100 on a terminal; 0 = unlimited")
	if err := fs.Parse(flagsFirst(args, "n")); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return errors.New("usage: scc ls <account>:[/path] or <account>://bucket[/path] [-p] [-r] [-n N]")
	}
	c, t, err := withTarget(fs.Arg(0))
	if err != nil {
		return err
	}
	max := *limit
	if max < 0 {
		max = 0
		if isTerminal(os.Stdout) {
			max = defaultListLimit
		}
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	defer w.Flush()

	if t.bucket == "" {
		names, err := c.Buckets(ctx())
		if err != nil {
			return err
		}
		for _, n := range names {
			fmt.Fprintf(w, "DIR\t%s/\n", n)
		}
		return nil
	}

	src, err := resolveSource(t.key, *prefixMode, func() (s3x.Object, error) {
		return listedObject(ctx(), c, t.bucket, t.key)
	})
	if err != nil {
		return err
	}
	var l *s3x.Listing
	if src.object != nil {
		l = &s3x.Listing{Objects: []s3x.Object{*src.object}}
	} else {
		l, err = listSource(ctx(), c, t.bucket, fs.Arg(0), src, *recursive, *prefixMode, int32(max))
		if err != nil {
			return err
		}
	}
	if len(l.Objects) == 0 && len(l.Prefixes) == 0 && !l.Truncated {
		if *prefixMode {
			noMatchingFiles(fs.Arg(0), l)
		} else {
			fmt.Fprintf(os.Stderr, "empty directory: %s\n", fs.Arg(0))
		}
	}
	for _, p := range l.Prefixes {
		fmt.Fprintf(w, "DIR\t%s\n", nameIn(p, src.prefix, *recursive))
	}
	for _, o := range l.Objects {
		fmt.Fprintf(w, "%s\t%s\t%s\n", humanSize(o.Size), o.LastModified.Format("2006-01-02 15:04"), nameIn(o.Key, src.prefix, *recursive))
	}
	if l.Truncated {
		w.Flush()
		fmt.Fprintf(os.Stderr, "… 只显示了前 %d 项；用 -n 0 显示全部，或 -n <数量> 调整\n", max)
	}
	return nil
}

const defaultListLimit = 100

func isTerminal(f *os.File) bool {
	fi, err := f.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}

// nameIn prints names relative to the directory portion of the prefix, so a
// partial prefix never cuts a filename. A recursive listing keeps full keys.
func nameIn(key, prefix string, recursive bool) string {
	if recursive || prefix == "" {
		return key
	}
	return strings.TrimPrefix(key, parentPrefix(prefix))
}

// bucketsCmd lists buckets explicitly, since "acct:" resolves to the default bucket when one is set.
func bucketsCmd(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: scc buckets <account>")
	}
	c, _, err := clientFor(strings.TrimSuffix(args[0], ":"))
	if err != nil {
		return err
	}
	names, err := c.Buckets(ctx())
	if err != nil {
		return err
	}
	for _, n := range names {
		fmt.Println(n)
	}
	return nil
}

func catCmd(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: scc cat <account>://bucket/key")
	}
	c, t, err := withTarget(args[0])
	if err != nil {
		return err
	}
	if t.bucket == "" || t.key == "" {
		return errors.New("cat needs a full object path")
	}
	out, err := c.Get(ctx(), t.bucket, t.key)
	if err != nil {
		return err
	}
	defer out.Body.Close()
	_, err = io.Copy(os.Stdout, out.Body)
	return err
}

func mbCmd(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: scc mb <account>://bucket")
	}
	c, bucket, err := bucketTarget(args[0])
	if err != nil {
		return err
	}
	return c.MkBucket(ctx(), bucket)
}

func rbCmd(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: scc rb <account>://bucket")
	}
	c, bucket, err := bucketTarget(args[0])
	if err != nil {
		return err
	}
	return c.RemoveBucket(ctx(), bucket)
}

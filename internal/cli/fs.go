package cli

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"text/tabwriter"
)

func lsCmd(args []string) error {
	fs := flag.NewFlagSet("ls", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	recursive := fs.Bool("r", false, "list recursively")
	limit := fs.Int("n", -1, "max entries to print: -1 = all when piped, 100 on a terminal; 0 = unlimited")
	if err := fs.Parse(flagsFirst(args, "n")); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return errors.New("usage: scc ls <account>:[/bucket[/prefix]] [-r] [-n N]")
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

	prefix := t.key
	if !*recursive && prefix != "" && !strings.HasSuffix(prefix, "/") {
		prefix += "/" // treat "bucket/dir" as a directory, the way a file browser expects
	}
	l, err := c.List(ctx(), t.bucket, prefix, *recursive, int32(max))
	if err != nil {
		return err
	}
	for _, p := range l.Prefixes {
		fmt.Fprintf(w, "DIR\t%s\n", nameIn(p, prefix, *recursive))
	}
	for _, o := range l.Objects {
		fmt.Fprintf(w, "%s\t%s\t%s\n", humanSize(o.Size), o.LastModified.Format("2006-01-02 15:04"), nameIn(o.Key, prefix, *recursive))
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

// nameIn prints names relative to the listed directory, like other S3 tools;
// a recursive listing keeps full keys so the output stays unambiguous.
func nameIn(key, prefix string, recursive bool) string {
	if recursive || prefix == "" {
		return key
	}
	return strings.TrimPrefix(key, prefix)
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
		return errors.New("usage: scc cat <account>:/bucket/key")
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

func rmCmd(args []string) error {
	fs := flag.NewFlagSet("rm", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	recursive := fs.Bool("r", false, "delete everything under the prefix")
	if err := fs.Parse(flagsFirst(args)); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return errors.New("usage: scc rm [-r] <account>:/bucket/key")
	}
	c, t, err := withTarget(fs.Arg(0))
	if err != nil {
		return err
	}
	if t.bucket == "" || t.key == "" {
		return errors.New("rm needs a key or a prefix")
	}
	if !*recursive {
		return c.Delete(ctx(), t.bucket, t.key)
	}
	n, err := c.DeletePrefix(ctx(), t.bucket, t.key)
	if err != nil {
		return err
	}
	fmt.Printf("deleted %d object(s)\n", n)
	return nil
}

func mbCmd(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: scc mb <account>:/bucket")
	}
	c, bucket, err := bucketTarget(args[0])
	if err != nil {
		return err
	}
	return c.MkBucket(ctx(), bucket)
}

func rbCmd(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: scc rb <account>:/bucket")
	}
	c, bucket, err := bucketTarget(args[0])
	if err != nil {
		return err
	}
	return c.RemoveBucket(ctx(), bucket)
}

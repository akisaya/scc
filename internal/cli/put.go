package cli

import (
	"errors"
	"flag"
	"io"
	"path/filepath"
)

func putCmd(args []string) error {
	fs := flag.NewFlagSet("put", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	recursive := fs.Bool("r", false, "upload directory contents recursively")
	skipExisting := fs.Bool("skip-existing", false, "keep existing S3 objects")
	if err := fs.Parse(flagsFirst(args)); err != nil {
		return err
	}
	if fs.NArg() != 2 {
		return errors.New("usage: scc put [-r] [--skip-existing] <local-source> <S3-destination>")
	}
	src, dst := fs.Arg(0), fs.Arg(1)
	if isS3(src) && filepath.VolumeName(src) == "" {
		return errors.New("put source must be a local path")
	}
	if !isS3(dst) {
		return errors.New("put requires an S3 destination")
	}
	return cpLocalToS3(src, dst, *recursive, *skipExisting)
}

package main

import (
	"fmt"
	"os"

	"scc/internal/cli"
	"scc/internal/s3x"
)

func main() {
	if err := cli.Run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "scc:", err)
		if h := s3x.Hint(err); h != "" {
			fmt.Fprintln(os.Stderr, "hint:", h)
		}
		os.Exit(1)
	}
}

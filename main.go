package main

import (
	"fmt"
	"os"

	"scc/internal/cli"
)

func main() {
	if err := cli.Run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "scc:", err)
		os.Exit(1)
	}
}

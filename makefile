# Makefile for Anime Notifier

GOCMD=@go
GOBUILD=$(GOCMD) build
GOINSTALL=$(GOCMD) install
GOTEST=@./go-test-color.sh
TSCMD=@tsc
IPTABLES=@sudo iptables
OSNAME=

ifeq ($(OS),Windows_NT)
	OSNAME = WINDOWS
else
	UNAME_S := $(shell uname -s)
	ifeq ($(UNAME_S),Linux)
		OSNAME = LINUX
	endif
	ifeq ($(UNAME_S),Darwin)
		OSNAME = OSX
	endif
endif

server:
	$(GOBUILD)
js:
	$(TSCMD)
install:
	$(GOINSTALL)
test:
	$(GOTEST) github.com/animenotifier/... -v -cover
bench:
	$(GOTEST) -bench .
tools:
	go get -u golang.org/x/tools/cmd/goimports
	go get -u github.com/aerogo/pack
	go get -u github.com/aerogo/run
	go install github.com/aerogo/pack
	go install github.com/aerogo/run
versions:
	@go version
	@asd --version
assets:
	$(TSCMD)
	@pack
depslist:
	$(GOCMD) list -f {{.Deps}} | sed -e 's/\[//g' -e 's/\]//g' | tr " " "\n"
clean:
	find . -type f | xargs file | grep "ELF.*executable" | awk -F: '{print $1}' | xargs rm
ports:
ifeq ($(OSNAME),LINUX)
	$(IPTABLES) -t nat -A OUTPUT -o lo -p tcp --dport 80 -j REDIRECT --to-port 4000
	$(IPTABLES) -t nat -A OUTPUT -o lo -p tcp --dport 443 -j REDIRECT --to-port 4001
endif
ifeq ($(OSNAME),OSX)
	@echo "rdr pass inet proto tcp from any to any port 443 -> 127.0.0.1 port 4001" | sudo pfctl -ef -
endif
browser:
ifeq ($(OSNAME),LINUX)
	@google-chrome --ignore-certificate-errors
endif
ifeq ($(OSNAME),OSX)
	@/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --ignore-certificate-errors
endif
all: assets server

.PHONY: ports

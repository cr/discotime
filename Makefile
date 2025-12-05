# Makefile for Discotime: inline JS/CSS, minify, and serve

JS   := $(wildcard js/*.js)
CSS  := $(wildcard style/*.css)

.PHONY: all inline clean server devserver minify

all: inline minify

inline: build/index.html

build:
	mkdir -p build

build/index.html: index.html $(JS) $(CSS) inline.py | build
	python3 inline.py index.html build/index.html

minify: build/index.html minify.py
	python3 minify.py build/index.html > build/index.min.html

server: build/index.html
	python3 -m http.server --directory build 8000

devserver:
	python3 -m http.server --directory . 8000

clean:
	rm -rf build
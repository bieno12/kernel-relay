#!/usr/bin/env node

// scripts/cli.js
const { program } = require('commander');

// 1) declare your options (with sensible defaults)
program
  .option('--proxy-url <url>', 'Jupyter proxy URL')
  .option('--local-port <port>', 'Local port to listen on')
  .option('--remote-host <host>', 'Remote host to connect to')
  .option('--remote-port <port>', 'Remote port to connect to');

program.parse(process.argv);
const opts = program.opts();

// 2) override process.env if flags were passed
if (opts.proxyUrl)   process.env.JUPYTER_PROXY_URL = opts.proxyUrl;
if (opts.localPort)  process.env.LOCAL_PORT         = opts.localPort;
if (opts.remoteHost) process.env.REMOTE_HOST        = opts.remoteHost;
if (opts.remotePort) process.env.REMOTE_PORT        = opts.remotePort;

// 3) now load & run your tool
require('../src/port-forwarder');

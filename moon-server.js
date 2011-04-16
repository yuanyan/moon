/*
 * Moon - js&css file server on top of nodejs
 * Copyright(c) 2011 Yuanyan <yuanyan.cao@gmail.com>
 * MIT Licensed
 */
 
// http://static.example.com/modulejs/global.js
// http://static.example.com/modulejs/global.css
// http://static.example.com/modulejs/?js=global,lang/Base,net/Request,net/Ajax

var Moon = require('./moon');

var opts= {
	"root":"./static/",  // root dir
	"listen": 80,       // 80 default
	"debug": true,      // debug
};

var server = new Moon(opts);
server.start();

//server.restart();
//server.stop();


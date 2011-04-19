/*
 * Moon - js&css file server on top of nodejs
 * Copyright(c) 2011 Yuanyan <yuanyan.cao@gmail.com>
 * MIT Licensed
 */


var server= "Moon/0.1.1(nodejs)";

//IMPORT
var fs = require('fs'),
    util = require('util'),
    EventEmitter = require('events').EventEmitter,
    Buffer = require('buffer').Buffer,
    http = require('http'),
    url = require('url'),
    path = require('path');

var defaultOpts={
    "root": ".",       //root dir
	"headers": { },     //custom headers
	"max_age" : 3600,   //max-age
	"listen": 80,      //default listen on 80 port
	"debug": true,     //debug mode
	"cache": true,     // enable cache
	"cache_timeout": 0,  //cache timeout, value '0' means never timeout 
	"cache_flush_time": 1000*60*60 //default flush cache every 1 hour

	// will implementation in next version
	
	//"cache_max_size": 1024*1024*64, //the default max size of cache is 64M
	//"cache_max_items": 1000, //the default max items of cache is 1000
	
	//"gzip": true,     //enable gzip
	//"gzip_ie": false,  //IE6 can't handle the gzip well 	
	
};

var MIME = {
  ".css": "text/css",
  ".js": "text/javascript"
}


function Moon(opts){
	
	for(var key in defaultOpts){
		if(defaultOpts.hasOwnProperty(key)){
			opts[key] = opts[key] || defaultOpts[key];
		}
	}
	
	if(opts.cache){
		this.cache={};
		if(opts.cache_timeout > 0)
			this.cache_flush(); 
	}
	
	this.opts=opts;

}

util.inherits(Moon, EventEmitter);
//EXPOSE
exports = module.exports = Moon;

//enable auto cache flush, delete the timeout cache
Moon.prototype.cache_flush = function(){

	var cache= this.cache,
		timeout = this.opts.cache_timeout;
		flush_time = this.opts.cache_flush_time;
	
	setInterval(function () {
	  var now = new Date();
	  
	  for (var id in cache) {
		if (!cache.hasOwnProperty(id)) continue;

		if (now - cache[id].timestamp > timeout) {
			delete cache[id];
		}
	  }
	},flush_time);

};

Moon.prototype.log = function(msg){

	if(this.opts.debug){
		util.log(msg);
	}
};

Moon.prototype.responder= function(status, headers, content, request, response) {

	response.setHeader('Date', (new Date()).toUTCString());
	response.writeHead(status, headers || {});
	response.end(content || '');

	
	var message = http.STATUS_CODES[status];
	this.log(message);

}

// do service
Moon.prototype.service = function(request, response){
	var that = this;

	if(this.filter(request, response)){
	
		this.access(request, response, function(err, headers, content){
	
			if (err) { // error
			
				//util.log(err.message); //ERROR
			
				that.responder(404, null, null, request, response);
				
			} else if (request.headers['if-none-match'] === headers['Etag'] && 
				Date.parse(request.headers['if-modified-since']) >= Date.parse( headers['Last-Modified'] ) ) {
				
				that.responder(304, headers, null, request, response);
				
			} else if (request.method === 'HEAD') {
			
				that.responder(200, headers, null, request, response);
				
			}else { // success
				
				that.responder(200, headers, content, request, response);
			}
	
		});
		
	}
	
};


Moon.prototype.filter = function(request, response){

	// make sure access a file not outside of the root
	if (request.url.indexOf('..') > 0){ 
		return this.responder(403, null, null, request, response);
	}

    // only allow GET and HEAD request
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return this.responder(405, { 'Allow': 'GET, HEAD' }, null, request, response);
    }
	
	return true;

};

// process header
Moon.prototype.process_header = function(headers, stats){
	
	headers['Etag']          = stats.size + '-' + Number(stats.mtime);
    headers['Last-Modified'] = stats.mtime.toUTCString();
	headers['Cache-Control'] = 'max-age=' + this.opts.max_age;
	headers['Server'] = server;	
	
    for (var key in this.opts.headers) {  
		headers[key] = this.opts.headers[key];
	}
	
	return headers;
};



Moon.prototype.access = function(request, response, callback){

	var urlObj = url.parse(request.url, true), 
		pathname= urlObj.pathname,
		search= urlObj.search;
		resourceIndentifier = pathname+search, 
		that = this; 
	
	
	if (this.cache && resourceIndentifier in this.cache) { 
		
		this.access_memory(resourceIndentifier, callback);
		
	} else {
	
		var query = urlObj.query,
			multifile= false,
			ext= "", //file ext
			files= [];
			
		for(var key in query){ //the query only support one query parameter except '_t'
			if(key === "_t"){
				continue;
			}
			ext=key;
			files=query[key].split(",");
			multifile = true;
			break;
		}
		
		if(multifile){
			for(var i=0,len=files.length; i<len; i++){
				files[i] = pathname + "/" + files[i] + "." +ext;	
			}
		}else{ //signal file
			files = [pathname];
		}
		
		
		for(var i=0, len=files.length; i<len; i++){
			files[i] = path.normalize( path.join(this.opts.root, files[i]) );
		}
		
		
		this.access_disk( files, function( err, buffer, stats ){
		
			if (err) {
				return callback(err);
			}
			
			var headers = {
				"Content-Type" : MIME[path.extname(files[0])],
				"Content-Length" : buffer.length
			};
			
			headers = that.process_header(headers, stats);
			
			that.cache[resourceIndentifier] = {
				headers: headers,
				content:    buffer,
				timestamp: new Date,
				hits: 1
			};
			
			callback(null, headers, buffer);
				
		});
		
		

	}

};

Moon.prototype.access_memory = function(resourceIndentifier, callback){

	var resource = this.cache[resourceIndentifier];	
	resource.hits += 1;
	
	callback(null, resource.headers, resource.content);

};


Moon.prototype.access_disk = function(files, callback){

	var that = this,
		bufferSize= 0,
		tick= 0,
		hasError = false;
		
	for(var i=0, len=files.length; i<len; i++){
		
		if(hasError) return;
	
		fs.stat(files[i], function (err, stats) {

			if (err) {
			
				if(!hasError){
					hasError = true;
					return callback(err);
				}
				
				return;
			}

			bufferSize += stats.size;
			
			if( ++tick === len ){
			
				that.stream(files, new Buffer(bufferSize), function (err, buffer, offset) {
			
					if (err) { //offset != bufferSize
						return callback(err);
					}
					
					stats.size = bufferSize; 
					
					callback(null, buffer, stats);

				});
			}
		});

	}

};


Moon.prototype.stream = function(files, buffer, callback){

	(function streamFile(files, offset) {
			
			var file = files.shift();

			if (file) {

				fs.createReadStream(file, {
					flags: 'r',
					encoding: 'binary',
					mode: 0666,
					bufferSize: 4096
				}).on('data', function (chunk) {
					buffer.write(chunk, offset, 'binary');
					offset    += chunk.length;
				}).on('close', function () {
					streamFile(files, offset);
				}).on('error', function (err) {
					callback(err);				
				});
			} else {

				callback(null, buffer, offset);
			}
			
	})(files.slice(0), 0);

};


// start server
Moon.prototype.start= function(){
	
	if(this.server) {
		util.log("Moon server already start");
		
	}else{
		var that = this;
		this.server = http.createServer(function (request, response) {
		
			request.on('end', function () {

				that.service(request, response);
				
			});
			
		}).listen(this.opts.listen);
		
		util.log("Moon server start");
	
	}
	

};

// stop server
Moon.prototype.stop= function(){
	
	if(this.server){
		this.server.close();
		this.cache = {} ;    // cache clear
		delete this.server;
		util.log("Moon server stop");
	}else{
		util.log("Moon server do not start");
	}


};

// restart server
Moon.prototype.restart= function(){
	this.stop();
	this.start();
	util.log("Moon server restart");	
};



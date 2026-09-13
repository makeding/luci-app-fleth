#!/usr/bin/env python3
"""Local browser fixture for the actual flethp view, with simulated LuCI/RPC.
No router calls, filesystem writes, downloads, or deployment. Ctrl-C stops it.
"""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
PAGE = '''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>flethp local preview fixture</title>
<style>body{font:16px sans-serif;max-width:900px;margin:24px auto;padding:12px}input,select,button{font:inherit;padding:6px}label{display:block}.cbi-value{margin:16px 0}.cbi-value-title{font-weight:bold;margin-bottom:8px}.cbi-value-field{min-width:0}p{line-height:1.5}.cbi-button:disabled{opacity:.6}</style>
<p>Local fixture — simulated LuCI/RPC, no router connected.</p>
<label>Language <select id="language"><option>ja</option><option>zh_Hans</option><option>zh_Hant</option></select></label>
<label>Line <select id="line"><option>DS-Lite</option><option>MAP-E</option><option>Failure</option></select></label>
<main id="view"></main>
<script>
var lang=new URL(location).searchParams.get('lang')||'ja';document.querySelector('#language').value=lang;
document.querySelector('#language').onchange=function(e){location.search='?lang='+e.target.value};
var optionTypes={DummyValue:'dummy',Value:'value'}, widgets={DeviceSelect:'device',NetworkSelect:'network'};
var options={},section={section:'pt',children:[],taboption:function(tab,type,name,title,description){
 var o={option:name,type:type,title:title,description:description,formvalue:function(){return o.input?o.input.value:undefined},cfgvalue:function(){return o.default||''},getUIElement:function(){return o.input}};
 options[name]=o;this.children.push(o);return o;
}};
function E(tag,attrs,children){var el=document.createElement(tag);Object.keys(attrs||{}).forEach(function(k){el.setAttribute(k,attrs[k])});(Array.isArray(children)?children:[children]).forEach(function(v){if(v!==undefined&&v!==null)el.append(v)});return el}
var listeners=[];var poll={add:function(fn){listeners.push(fn)},remove:function(fn){listeners=listeners.filter(function(f){return f!==fn})}};
setInterval(function(){listeners.slice().forEach(function(fn){fn()})},5000);
var protocol;var network={registerPatternVirtual:function(){},registerProtocol:function(n,p){protocol=p;return p},getIfnameOf:function(n){return n}};
var rpc={declare:function(){return function(){return Promise.resolve({up:false,data:{}})}}};
var fs={exec:function(path,args){return new Promise(function(resolve){var line=document.querySelector('#line').value;setTimeout(function(){
 var isMap=line==='MAP-E'&&!args[2];var data=line==='Failure'?{error_code:'NO_LOCAL_IPV6'}:{state:'detected',mode:isMap?'map-e':'dslite',client_ipv4:isMap?'203.0.113.8':'192.0.0.2',client_prefixlen:args[3]||(isMap?31:29),gateway_ipv4:args[4]||(isMap?'203.0.113.9':'192.0.0.1'),peeraddr:'2001:db8::1',ports:isMap?Array.from({length:15},function(_,i){return (4144+i*4096)+'-'+(4159+i*4096)}).join(' '):'',internet_verified:false};resolve({code:0,stdout:JSON.stringify(data)})},400)})}};
Promise.all([fetch('/source').then(function(r){return r.text()}),fetch('/translations?lang='+lang).then(function(r){return r.json()})]).then(function(results){
 var translate=function(v){return results[1][v]||v};
 new Function('form','network','poll','rpc','fs','widgets','E','_','L',results[0])(optionTypes,network,poll,rpc,fs,widgets,E,translate,{resolveDefault:function(p,f){return Promise.resolve(p).catch(function(){return f})}});
 protocol.renderFormOptions(section);
 var view=document.querySelector('#view');section.children.forEach(function(o){if(o.render){view.append(o.render());return}var box=E('div',{'class':'cbi-value'},E('label',{},o.title||''));if(o.type==='dummy'){var value=E('div',{},[]);if(o.cfgvalue)value.innerHTML=o.cfgvalue();box.append(value)}else{o.input=E('input',{'value':o.default||'','placeholder':o.placeholder||''});box.append(o.input);if(o.description)box.append(E('p',{},o.description))}view.append(box)});
 document.querySelector('#line').onchange=function(){var b=view.querySelector('button');if(b)b.click()};
});
</script>'''

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/source':
            data = (ROOT/'htdocs/luci-static/resources/protocol/flethp.js').read_bytes()
            kind = 'text/javascript'
        elif self.path.startswith('/translations?lang='):
            lang = self.path.split('=',1)[1]
            if lang not in ['ja','zh_Hans','zh_Hant']: lang='ja'
            entries={};key=None
            for line in (ROOT/f'po/{lang}/fleth.po').read_text().splitlines():
                if line.startswith('msgid '): key=json.loads(line[6:])
                elif line.startswith('msgstr ') and key: entries[key]=json.loads(line[7:])
            data=json.dumps(entries).encode();kind='application/json'
        else:
            data=PAGE.encode();kind='text/html'
        self.send_response(200);self.send_header('Content-Type',kind+'; charset=utf-8');self.end_headers();self.wfile.write(data)

if __name__ == '__main__':
    server=HTTPServer(('127.0.0.1',18767),Handler)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()

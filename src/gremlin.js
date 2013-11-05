var http = require("http");
var q = require("q");

var Utils = require("./utils");
var isObject = Utils.isObject;
var isArray = Utils.isArray;
var isClosure = Utils.isClosure;
var isGraphReference = Utils.isGraphReference;
var isRegexId = Utils.isRegexId;
//var merge = Utils.merge;


var pathBase = '/graphs/';
var gremlinExt = '/tp/gremlin?script=';


function qryMain(method, reset){
    return function(){
        var self = this,
            gremlin = reset ? new Gremlin(this) : self._buildGremlin(self.params),
            args = '',
            appendArg = '';

        //cater for select array parameters
        if(method == 'select'){
            args = arguments;
            gremlin.params += '.' + method + buildArgs.call(self, args, true);
        } else {
            args = isArray(arguments[0]) ? arguments[0] : arguments;
            //cater for idx param 2
            if(method == 'idx' && args.length > 1){
                for (var k in args[1]){
                    appendArg = k + ":";
                    appendArg += parseArgs.call(self, args[1][k]);
                }
                appendArg = "[["+ appendArg + "]]";
                args.length = 1;
            }
            gremlin.params += '.' + method + buildArgs.call(self, args);
        }
        gremlin.params += appendArg;
        return gremlin;
    };
}

function qrySql(){
    return function(){
        var restCmd,
            args = arguments[0];

        restCmd = new REST(this.OPTS, '/command/', '/sql');
        restCmd.params = args;
        return restCmd;
    };
}

function createCommand(template, config){
    var vals = template.match(/<([^<>]*)>/g),
        valLen = vals.length,
        optionalVals = template.match(/\[([^\[\]]*)\]/g);
    return function() {
        var self = this,
            valTemp,
            argsLen = arguments.length,
            i = 0,
            j = 0,
            args = {},
            isDescriptor = false,
            temp,
            sqlCmd = qrySql();

        if(argsLen == 1 && isObject(arguments[0])){
            //check to see if the passed in Object is
            //an actual argument or a descriptor i.e addVertex can take
            //an object as the first parameter
            for (j = 0; j < valLen; j++) {
                valTemp = vals[j].slice(1,-1);
                if((valTemp in arguments[0]) && arguments[0].hasOwnProperty(valTemp)){
                    isDescriptor = true;
                    break;
                }
            }
            
            if(isDescriptor){
                args = arguments[0];
            } else {
                //must have a config.parameters[0]
                args[config.parameters[0]] = arguments[0];                    
            }

        } else {
            for (i = 0; i < argsLen; i++) {
                args[config.parameters[i]] = arguments[i];
            }
        }
        temp = supplant(template, args);
        if(config && 'defaults' in config){
            temp = supplant(temp, config.defaults);
        }
        
        for (var m = optionalVals.length - 1; m >= 0; m--) {
            temp = temp.replace(optionalVals[m], "");
        }
        temp = temp.replace(/\[|\]/g, "");
        return sqlCmd.call(self, temp);
    };
}

module.exports = { 'qryMain': qryMain,
                    'qrySql': qrySql,
                    'createCommand': createCommand 
                };


//[i] => index & [1..2] => range
//Do not pass in method name, just string arg
function qryIndex(){
    return function(arg) {
        var gremlin = this._buildGremlin(this.params);
        gremlin.params += '['+ arg.toString() + ']';
        return gremlin;
    };
}


//and | or | put  => g.v(1).outE().or(g._().has('id', 'T.eq', 9), g._().has('weight', 'T.lt', '0.6f'))
function qryPipes(method){
    return function() {
        var self = this,
            gremlin = self._buildGremlin(this.params),
            args = [],
            isArr = isArray(arguments[0]),
            argsLen = isArr ? arguments[0].length : arguments.length;

        gremlin.params += "." + method + "(";
        for (var _i = 0; _i < argsLen; _i++) {
            gremlin.params += isArr ? arguments[0][_i].params || parseArgs.call(self, arguments[0][_i]) : arguments[_i].params || parseArgs.call(self, arguments[_i]);
            gremlin.params += ",";
        }
        gremlin.params = gremlin.params.slice(0, -1);
        gremlin.params += ")";
        return gremlin;
    };
}

//retain & except => g.V().retain([g.v(1), g.v(2), g.v(3)])
function qryCollection(method){
    return function() {
        var self = this,
            gremlin = this._buildGremlin(this.params),
            param = '';

        if(isArray(arguments[0])){
            for (var _i = 0, argsLen = arguments[0].length; _i < argsLen; _i++) {
                param += arguments[0][_i].params;
                param += ",";
            }
            gremlin.params += "." + method + "([" + param + "])";
        } else {
            gremlin.params += "." + method + buildArgs.call(self, arguments[0]);
        }
        return gremlin;
    };
}

function buildArgs(array, retainArray) {
    var self = this,
        argList = '',
        append = '',
        jsonString = '';

    for (var _i = 0, l = array.length; _i < l; _i++) {
        if(isClosure(array[_i])){
            append += array[_i];
        } else if (isObject(array[_i]) && array[_i].hasOwnProperty('verbatim')) {
            argList += array[_i].verbatim + ",";
        } else if (isObject(array[_i]) && !(array[_i].hasOwnProperty('params') && isGraphReference(array[_i].params))) {
            jsonString = JSON.stringify(array[_i]);
            jsonString = jsonString.replace('{', '[');
            argList += jsonString.replace('}', ']') + ",";
        } else if(retainArray && isArray(array[_i])) {
            argList += "[" + parseArgs.call(self, array[_i]) + "],";
        } else {
            argList += parseArgs.call(self, array[_i]) + ",";
        }
    }
    argList = argList.slice(0, -1);
    return '(' + argList + ')' + append;
}

function parseArgs(val) {
    if(val === null) {
        return 'null';
    }
    //check to see if the arg is referencing the graph ie. g.v(1)
    if(isObject(val) && val.hasOwnProperty('params') && isGraphReference(val.params)){
        return val.params.toString();
    }
    if(isGraphReference(val)) {
        return val.toString();
    }
    //Cater for ids that are not numbers but pass parseFloat test
    if(isRegexId.call(this, val) || isNaN(parseFloat(val))) {
        return "'" + val + "'";
    }
    if(!isNaN(parseFloat(val))) {
         return val.toString();
    }
    return val;
}



Gremlin = (function () {
    function Gremlin(OrientDB) {
        this.OrientDB = OrientDB;
        this.OPTS = OrientDB.OPTS;
        // if('sid' in options){
        //     this.sid = options.sid;
        // }
        this.cmdUrl = '/command/';//cmdUrl || '/command/';
        this.cmdTypeUrl = '/gremlin';//cmdTypeUrl || '/gremlin';
        this.httpStr = "http://";//options.ssl ? "https://" : "http://";

        this.params = 'g';
    }

    function basic_auth(user, password) {
        var tok = user + ':' + password;
        var hash = new Buffer(tok).toString('base64');
        return "Basic " + hash;
    };

    function auth() {
        return function(){
            var deferred = q.defer();
            var options = {
                'host': this.OPTS.host,
                'port': this.OPTS.port,
                'path': '/connect/' + this.OPTS.database,
                headers: {
                    'Authorization': basic_auth(this.OPTS.user, this.OPTS.password)
                },
                'method': 'GET'
            };

            http.get(options, function(res) {
                var body = '';
                var resp = '';
                res.on('data', function(results) {
                    body += results;
                });
    
                res.on('end', function() {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resp = !!res.length ? JSON.parse(body) : {'sid':res.headers['set-cookie'][0].split(';'), status: res.statusCode, statusText: 'No content'};
                        deferred.resolve(resp);
                    } else {
                        deferred.reject(res);
                    }
                });
            }).on('error', function(e) {
                deferred.reject(e);
            });
            return deferred.promise;
        };
    };

    function get() {
        return function(callback){
            return getData.call(this).then().nodeify(callback);
        };
    }

    // function getData() {
    //     var self = this;
    //     var deferred = q.defer();
    //     var options = {
    //         'host': this.OPTS.host,
    //         'port': this.OPTS.port,
    //         'path': pathBase + this.OPTS.graph + gremlinExt + encodeURIComponent(this.params) + '&rexster.showTypes=true',
    //         headers: {
    //             'Content-Type': 'application/x-www-form-urlencoded'
    //         },
    //         'method': 'GET'
    //     };

    //     http.get(options, function(res) {
    //         var body = '';
    //         var typeMap = {};
    //         var tempObj = {};
    //         var returnObj = {};
    //         var resultObj = { results: [], typeMap: {} };
    //         var n;
    //         res.on('data', function(results) {
    //             body += results;
    //         });

    //         res.on('end', function() {
    //             deferred.resolve(transformResults.call(self.OrientDB, JSON.parse(body).results));
    //         });

    //     }).on('error', function(e) {
    //         deferred.reject(e);
    //     });

    //     return deferred.promise;
    // }


    function postData(){
        var deferred = q.defer();
        var payload = this.params || '{}';
        var body = '';
        var options = {
            'host': this.OPTS.host,
            'port': this.OPTS.port,
            'path': this.cmdUrl + this.OPTS.database + this.cmdTypeUrl,
            headers: {
                'Authorization': basic_auth(this.OPTS.user, this.OPTS.password),
                'Cookie': this.OPTS.sid,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload, 'utf8')
            },
            'method': 'POST'
        };

        var req = http.request(options, function(res) {
            res.on('data', function (chunk) {
                body += chunk;
            });
            res.on('end', function() {
                //console.log(body);
                deferred.resolve(JSON.parse(body));
            });
        });

        req.on('error', function(e) {
            console.error('problem with request: ' + e.message);
            deferred.reject("Error: " + e.message);
        });

        // write data to request body
        req.write(payload);
        req.end();
        return deferred.promise;
    };


    var post = function() {
        return function(callback){
            return postData.call(this).then().nodeify(callback);
        };
    };

    // function createTypeDef(obj){
    //     var tempObj = {},
    //         tempTypeObj = {},
    //         tempResultObj = {},
    //         tempTypeArr = [],
    //         tempResultArr = [],
    //         tempTypeArrLen = 0,
    //         len = 0, rest = 1,
    //         mergedObject = {},
    //         returnObj = {typeDef:{}, result: {}};

    //     if (isArray(obj)) {
    //         len = obj.length;
    //         for (var i = 0; i < len; i++) {
    //             if (obj[i].type == 'map' || obj[i].type == 'list') {
    //                 tempObj = createTypeDef(obj[i].value);
    //                 tempTypeArr[i] = tempObj.typeDef;
    //                 tempResultArr[i] = tempObj.result;
    //             } else {
    //                 tempTypeArr.push(obj[i].type);
    //                 tempResultArr.push(obj[i].value);
    //             }

    //             if(i > 0) {
    //                 //If type is map or list need to do deep compare
    //                 //to ascertain whether equal or not
    //                 //determine if the array has same types
    //                 //then only show the type upto that index
    //                 if (obj[i].type !== obj[i - 1].type) {
    //                     rest = i + 1;
    //                 }
    //             }
    //         }

    //         if(rest > 1 && isObject(tempTypeArr[rest])){
    //             //merge remaining objects
    //             tempTypeArrLen = tempTypeArr.length;
    //             mergedObject = tempTypeArr[rest - 1];
    //             for(var j = rest;j < tempTypeArrLen; j++){
    //                 mergedObject = merge(mergedObject, tempTypeArr[j]);
    //             }
    //             tempResultArr[rest - 1] = mergedObject;
    //         }

    //         tempTypeArr.length = rest;
    //         returnObj.typeDef = tempTypeArr;
    //         returnObj.result = tempResultArr;
    //     } else {
    //         for(var k in obj){
    //             if (obj.hasOwnProperty(k)) {
    //                 if(obj[k].type == 'map' || obj[k].type == 'list'){
    //                     tempObj = createTypeDef(obj[k].value);
    //                     tempTypeObj[k] = tempObj.typeDef;
    //                     tempResultObj[k] = tempObj.result;
    //                 } else {
    //                     tempTypeObj[k] = obj[k].type;
    //                     tempResultObj[k] = obj[k].value;
    //                 }
    //             }
    //         }
    //         returnObj.typeDef = tempTypeObj;
    //         returnObj.result = tempResultObj;

    //     }

    //     return returnObj;
    // }

    // function transformResults(results){
    //     var typeMap = {};
    //     var typeObj, tempObj, returnObj;
    //     var result = { success: true, results: [], typeMap: {} };
    //     var n, l = results ? results.length : 0;

    //     for(n = 0; n<l; n++){
    //         tempObj = results[n];
    //         if (isObject(tempObj)) {
    //             returnObj = {};
    //             typeObj = {};
    //             for(var k in tempObj){
    //                 if (tempObj.hasOwnProperty(k)) {
    //                     if (isObject(tempObj[k]) && 'type' in tempObj[k]) {
    //                         if(!!typeMap[k] && typeMap[k] != tempObj[k].type){
    //                             if(!result.typeMapErr){
    //                                 result.typeMapErr = {};
    //                             }
    //                             console.error('_id:' + tempObj._id + ' => {' + k + ':' + tempObj[k].type + '}');
    //                             //only capture the first error
    //                             if(!(k in result.typeMapErr)){
    //                                 result.typeMapErr[k] = typeMap[k] + ' <=> ' + tempObj[k].type;
    //                             }
    //                         }
    //                         if (tempObj[k].type == 'map' || tempObj[k].type == 'list') {
    //                             //build recursive func to build object
    //                             typeObj = createTypeDef(tempObj[k].value);
    //                             typeMap[k] = typeObj.typeDef;
    //                             returnObj[k] = typeObj.result;
    //                         } else {
    //                             typeMap[k] = tempObj[k].type;
    //                             returnObj[k] = tempObj[k].value;
    //                         }
    //                     } else {
    //                         returnObj[k] = tempObj[k];
    //                     }
    //                 }
    //             }
    //             result.results.push(returnObj);
    //         } else {
    //             result.results.push(tempObj);
    //         }
    //     }

    //     result.typeMap = typeMap;
    //     //This will preserve any locally defined TypeDefs
    //     this.typeMap = merge(this.typeMap, typeMap);
    //     return result;
    // }

    Gremlin.prototype = {
        _buildGremlin: function (qryString){
            this.params = qryString;
            return this;
        },

        /*** Transform ***/
        _: qryMain('_'),
        both: qryMain('both'),
        bothE: qryMain('bothE'),
        bothV: qryMain('bothV'),
        cap: qryMain('cap'),
        gather: qryMain('gather'),
        id: qryMain('id'),
        'in': qryMain('in'),
        inE: qryMain('inE'),
        inV: qryMain('inV'),
        property: qryMain('property'),
        label: qryMain('label'),
        map: qryMain('map'),
        memoize: qryMain('memoize'),
        order: qryMain('order'),
        out: qryMain('out'),
        outE: qryMain('outE'),
        outV: qryMain('outV'),
        path: qryMain('path'),
        scatter: qryMain('scatter'),
        select: qryMain('select'),
        transform: qryMain('transform'),
        orderMap: qryMain('orderMap'),

        /*** Filter ***/
        index: qryIndex(), //index(i)
        range: qryIndex(), //range('[i..j]')
        and:  qryPipes('and'),
        back:  qryMain('back'),
        dedup: qryMain('dedup'),
        except: qryCollection('except'),
        filter: qryMain('filter'),
        has: qryMain('has'),
        hasNot: qryMain('hasNot'),
        interval: qryMain('interval'),
        or: qryPipes('or'),
        random: qryMain('random'),
        retain: qryCollection('retain'),
        simplePath: qryMain('simplePath'),

        /*** Side Effect ***/
        // aggregate //Not implemented
        as: qryMain('as'),
        groupBy: qryMain('groupBy'),
        groupCount: qryMain('groupCount'), //Not Fully Implemented ??
        optional: qryMain('optional'),
        sideEffect: qryMain('sideEffect'),

        linkBoth: qryMain('linkBoth'),
        linkIn: qryMain('linkIn'),
        linkOut: qryMain('linkOut'),
        // store //Not implemented
        // table //Not implemented
        // tree //Not implemented

        /*** Branch ***/
        copySplit: qryPipes('copySplit'),
        exhaustMerge: qryMain('exhaustMerge'),
        fairMerge: qryMain('fairMerge'),
        ifThenElse: qryMain('ifThenElse'), //g.v(1).out().ifThenElse('{it.name=='josh'}','{it.age}','{it.name}')
        loop: qryMain('loop'),

        /*** Methods ***/
        //fill //Not implemented
        count: qryMain('count'),
        iterate: qryMain('iterate'),
        next: qryMain('next'),
        toList: qryMain('toList'),
        keys: qryMain('keys'),
        remove: qryMain('remove'),
        values: qryMain('values'),
        put: qryPipes('put'),

        getPropertyKeys: qryMain('getPropertyKeys'),
        setProperty: qryMain('setProperty'),
        getProperty: qryMain('getProperty'),

        /*** http ***/
        get: post(),
        authenticate: auth()

    };

    return Gremlin;
})();
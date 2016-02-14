var async = require('async');
var kue = require('kue');
var queue = kue.createQueue(require("../lib/queue_conf.js"));
var H = require("../static/js/h.js")
var Pub = require("../api/pub.js")
var Pieces = require("../api/pieces.js")
var Clocks = require("../api/clocks.js")

var Worker = module.exports = (function(){
    var Worker = {}

    var CONCURRENCY = 1000

    Worker.init = function(){
        H.log("INFO. Starting Worker.remove_army")
        queue.process('remove_army', CONCURRENCY, function(job, done){
            remove_army(job.data, done);
        });
    }

    function remove_army(data, done){
        var playerID = data.player._id
        var army_id = data.army_id
        H.log("INFO. Worker.remove_army", playerID, army_id)
        Pieces.removePlayerArmyByID(playerID, army_id, function(er, pieces){
            if (pieces){
                Pub.removeMany(pieces)
                Clocks.removeMany(pieces)
            } else if (er){
                H.log("ERROR. Worker.remove_army", data, er)
            }
            done(er)
        })
    }

    return Worker
}())

Worker.init()

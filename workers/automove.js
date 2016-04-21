var async = require('async');
var kue = require('kue');
var queue = kue.createQueue(require("../lib/queue_conf.js"));
var H = require("../static/js/h.js")
var Pub = require("../api/pub.js")
var Pieces = require("../api/pieces.js")
var Clocks = require("../api/clocks.js")
var Game = require("../api/game.js")
var Job = require("../models/job.js")
var Player = require("../models/player.js")
var Conf = require("../static/conf.json") // shared with client

var Worker = module.exports = (function(){
    var Worker = {}

    var CONCURRENCY = 1000
    var AUTOMOVE_INTERVAL = Conf.recharge

    Worker.init = function(){
        H.p("Starting Worker.automove")
        queue.process('automove', CONCURRENCY, function(_job, done){
            // NOTE. Use this pattern to check if the job has been
            // cancelled, i.e. removed from the mongo db. Jobs are
            // stored in mongo, only the jobID is sent to this worker
            var data = _job.data
            var jobID = data.jobID
            Job.checkJobCancelled(jobID, function(er, job){
                if (er) done(er)
                else automove(job, done)
            })
        });
    }

    // job is the mongo job obj
    // data = {
    //     playerID: playerID,
    //     pieceID: pieceID,
    //     to: [x, y],
    // }
    function automove(job, done){
        var jobID = job._id
        var data = job.data
        var playerID = data.playerID
        var player = null
        H.p("Worker.automove", data)
        async.waterfall([
            function(done){
                Player.findOneByID(playerID, function(er, _player){
                    player = _player
                    done(er)
                })
            },
            function(done){
                automove_loop(jobID, player, data, done)
            }
        ], function(er){
            done(er)
        })
    }

    function automove_loop(jobID, player, data, done){
        var working = false
        var pieceID = data.pieceID
        var finalTo = data.to
        var nextTo = null
        var lastSuccessfulMove = new Date("2016").getTime() // some time long ago
        var automove_timeout = setInterval(function(){
            if (working) return

            // gotta do this instead of a straight forward setInterval
            // because the interval might end early, and the move will
            // fail because the piece's clock is still on. in that
            // case we can retry a second later with this approach
            if (new Date().getTime() - lastSuccessfulMove < AUTOMOVE_INTERVAL) return

            // mach check job cancelled each iteration
            async.waterfall([
                function(done){
                    best_move(pieceID, finalTo, function(er, _nextTo){
                        nextTo = _nextTo
                        done(er)
                    })
                },
                function(done){
                    data.to = nextTo
                    Game.on.move(player, data, done)
                }
            ], function(er){
                if (er){
                    // mach
                    // stop automove if error for now
                    clearInterval(automove_timeout)
                    done(er)
                } else if (H.compareLists(finalTo, nextTo)){ // got to destination
                    clearInterval(automove_timeout)
                    done(null)
                } else {
                    working = false // continue
                    lastSuccessfulMove = new Date().getTime()
                }
            })
        }, 1000)
    }

    function best_move(pieceID, to, done){
        var moves = []
        var nTo = [] // [x, y]
        async.waterfall([
            function(done){
                Game.findAvailableMoves(pieceID, function(er, _moves){
                    moves = _moves
                    done(er)
                })
            },
            function(done){
                nTo = best_to(moves, to)
                done(null)
            }
        ], function(er){
            done(er, nTo)
        })
    }

    function best_to(moves, to){
        var moves_with_dist = []
        moves.forEach(function(move){
            moves_with_dist.push({
                move: move,
                dist: Math.abs(move[0] - to[0]) + Math.abs(move[1] - to[1])
            })
        })
        moves_with_dist.sort(function(a, b){
            return a.dist - b.dist
        })
        // mach remove
        // H.p("best_to", [moves_with_dist[0].move, moves_with_dist])
        return moves_with_dist[0].move
    }

    return Worker
}())

Worker.init()

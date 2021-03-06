var async = require("async")
var request = require("request")
var express = require('express');
var Piece = require("../models/piece.js")
var Player = require("../models/player.js")
var H = require("../static/js/h.js")
var Conf = require("../static/conf.json") // shared with client
var Sanitize = require("../lib/sanitize.js")
var DB = require("../db.js")
var S = Conf.zone_size

var OK = "OK"

var Pieces = module.exports = (function(){
    var Pieces = {
        router: express.Router()
    }

    var ERROR_GET_PIECES = "ERROR. Can't populate pieces"

    Pieces.router.route("/:x/:y")
        .get(function(req, res){
            try {
                var x = Math.floor(Sanitize.integer(H.param(req, "x")) / S) * S
                var y = Math.floor(Sanitize.integer(H.param(req, "y")) / S) * S
                // var r = Sanitize.integer(H.param(req, "r"))
                var r = S // use default zone size
            } catch (e){
                return res.send({info:ERROR_GET_PIECES})
            }
            DB.find("pieces", {
                x: {$gte: x, $lt: x + r},
                y: {$gte: y, $lt: y + r},
            }, function(er, pieces){
                if (pieces){
                    res.send({ok:true, pieces:pieces})
                } else {
                    res.send({info:ERROR_GET_PIECES})
                }
            })
        })

    Pieces.makePiece = function(piece, done){
        piece.created = new Date()
        piece.alive = true
        DB.insert("pieces", piece, function(er, pieces){
            if (pieces && pieces.length) done(null, pieces[0])
            else done(["ERROR. Pieces.makePiece", piece, er])
        })
    }

    // Converts player's losing army to enemy's side
    Pieces.defect = function(playerID, enemyID, defector_army_id, defectee_army_id, done){
        DB.update("pieces", {
            player: playerID,
            army_id: defector_army_id,
        }, {
            $set: {
                player: enemyID,
                army_id: defectee_army_id,
                alive: true,
            }
        }, {
            multi: true,
        }, function(er, re){
            if (done) done(er)
        })
    }

    Pieces.validatePieceTimeout = function(piece, done){
        // new Date(null) == Start of Epoch, so if else check will
        // work out: piece can move.
        // NOTE. new Date(undefined) == invalid date so need to || null
        var elapsed = Date.now() - new Date(piece.moved || null).getTime()
        if (elapsed >= Conf.recharge){
            done(null, 0)
        } else {
            var wait_time = Conf.recharge - elapsed
            done("Charging: ready in " + parseInt((wait_time) / 1000) + " sec.", wait_time)
        }
    }

    Pieces.findPiecesInZone = function(_x, _y, done){
        var x = H.toZoneCoordinate(_x, S)
        var y = H.toZoneCoordinate(_y, S)
        DB.find("pieces", {
            x: {$gte: x, $lt: x + S},
            y: {$gte: y, $lt: y + S},
        }, function(er, _pieces){
            if (_pieces){
                done(null, _pieces)
            } else {
                done(["ERROR. Pieces.findPiecesInZone", _x, _y, er])
            }
        })
    }

    Pieces.set_player_army_alive = function(playerID, army_id, alive, done){
        try {
            playerID = DB.ObjectID(playerID)
            army_id = DB.ObjectID(army_id)            
        } catch (e){
            console.log("ERROR. Pieces.set_player_army_alive: invalid playerID and army_id")
            return done({error:"Pieces.set_player_army_alive"})
        }
        DB.update("pieces", {
            player: playerID,
            army_id: army_id,
        }, {
            $set: {
                alive: alive,
            }
        }, {
            multi: true,
        }, function(er, re){
            if (er) done(["ERROR. Pieces.disable_player_army", playerID, army_id, alive, er, re])
            else done(null)
        })
    }

    Pieces.findPlayerKing = function(playerID, done){
        try {
            nPlayerID = DB.ObjectID(playerID)
        } catch (e){
            return done(["ERROR. Pieces.findPlayerKing: invalid data", playerID])
        }
        DB.findOne("pieces", {
            player: nPlayerID,
            kind: "king"
        }, function(er, king){
            if (er) done(["ERROR. Pieces.findPlayerKing", playerID, er])
            else if (king) done(null, king)
            else done(null, null)
        })
    }

    Pieces.find_piece_at_xy = function(x, y, done){
        DB.findOne("pieces", {
            x: x,
            y: y,
        }, function(er, _piece){
            done(er, _piece)
        });
    }


    return Pieces
}())

var Test = (function(){
    var Test = {}

    Test.main = function(){
        var DB = require("../db.js") // connect to mongo for db tests
        var method = process.argv[2]
        var args = process.argv.slice(3)
        Test[method](args)
    }

    Test.defect = function(args){
        setTimeout(function(){
            var playerID = args[0]
            var enemyID = args[1]
            Pieces.defect(playerID, enemyID, function(er){
                console.log("Test.defect", JSON.stringify(er, 0, 2))
                process.exit(0)
            })
        }, 2000)
    }

    return Test
}())

if (require.main == module){
    Test.main()
} else {

}

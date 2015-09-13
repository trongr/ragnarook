// you can't move the same piece twice in the same round

// free roaming lets you move any piece to a neighbouring grid, but no
// farther

var K = (function(){

    var K = {
        INIT_CAM_POS: 15,
        BOARD_SIZE: 10,
        CUBE_SIZE: 1,
        QUADRANT_SIZE: 10,

        code: {
            turn: {
                timeout: {
                    code: "timeout",
                    info: "ERROR. Turn request too early"
                },
                gameover: {
                    code: "gameover",
                    info: "ERROR. Can't request turn: gameover"
                },
                enemy_dead: {
                    code: "enemy_dead",
                    info: "ERROR. Can't request turn: enemy dead"
                },
                none: {
                    code: "none",
                    info: "ERROR. No more turn"
                },
            },
            move: {
                gameover: {
                    code: "gameover",
                    info: "ERROR. Can't move: gameover"
                },
            },
            gameover: {
                error: {
                    code: "error",
                    info: "ERROR. Unknown gameover error"
                }
            }
        }

    }
    K.CUBE_GEO = new THREE.BoxGeometry(K.CUBE_SIZE, K.CUBE_SIZE, K.CUBE_SIZE)

    return K
}())

var Turn = (function(){
    var Turn = {}

    var TURN_TIMEOUT = 30000
    // var TURN_TIMEOUT = 5000 // mach tog
    var TURN_TIMEOUT_S = TURN_TIMEOUT / 1000
    var _timersForNewTurnRequest = {} // keyed by enemy._id. Time til sending new turn request
    var _timersForNewTurn = {} // keyed by enemy._id. Time til new turn
    var _timersForTurnExpire = {} // keyed by enemy._id. Time til turn expires

    Turn.init = function(player){
        var tokens = player.turn_tokens
        for (var i = 0; i < tokens.length; i++){
            var token = tokens[i]
            if (!token.live){
                Turn.countDownTilNewTurn(token.player)
            }
        }
    }

    // Calls whenever someone moves
    Turn.update = function(mover){
        API.Player.get({}, function(er, re){
            if (er) return console.log("ERROR. API.Player.get", er)
            var you = re.player
            if (mover._id == you._id){
                updatePlayerTurns(mover)
            } else {
                updateEnemyTurns(you, mover)
            }
            Hud.renderTurns(you)
        })
    }

    function updatePlayerTurns(you){
        if (you.turn_tokens.length){
            var enemy = you.turn_tokens[(you.turn_index - 1 + you.turn_tokens.length) % you.turn_tokens.length]
            var enemyID = enemy.player
            Turn.countDownTilNewTurn(enemyID)
        } else {
            msg.info("Free roaming")
        }
    }

    function updateEnemyTurns(you, enemy){
        if (enemy.turn_tokens.length){
            var enemyEnemy = enemy.turn_tokens[(enemy.turn_index - 1 + enemy.turn_tokens.length) % enemy.turn_tokens.length]
            var enemyID = enemy._id
            if (enemyEnemy.player == you._id){ // the enemy of my enemy might be me lol
                Turn.countDownTilTurnExpires(enemyID)
            }
        } // otw enemy is free roaming
    }

    Turn.startTimerForNewTurnRequest = function(enemyID, timeout){
        Turn.clearTimerForNewTurnRequest(enemyID)
        var you = Player.getPlayer()
        var to = setTimeout(function(){
            Sock.send("turn", {
                playerID: you._id,
                enemyID: enemyID,
            })
        }, timeout || TURN_TIMEOUT)
        _timersForNewTurnRequest[enemyID] = to
    }

    Turn.clearTimerForNewTurnRequest = function(enemyID){
        clearTimeout(_timersForNewTurnRequest[enemyID])
    }

    Turn.startTimerForNewTurn = function(enemyID){
        Turn.clearTimerForNewTurn(enemyID)
        var time = TURN_TIMEOUT_S;
        var interval = setInterval(function(){
            $("#" + enemyID + " .player_countdown")
                .html(s2mmss(time) + " til new turn")
            time--
        }, 1000);
        _timersForNewTurn[enemyID] = interval
    }

    Turn.clearTimerForNewTurn = function(enemyID){
        clearInterval(_timersForNewTurn[enemyID])
    }

    function s2mmss(s){
        var t = Math.abs(s)
        var sign, mm, ss;
        sign = (s < 0 ? "-" : "")
        mm = parseInt(t / 60, 10);
        ss = parseInt(t % 60, 10);
        mm = mm < 10 ? "0" + mm : mm;
        ss = ss < 10 ? "0" + ss : ss;
        return sign + mm + ":" + ss
    }

    Turn.startTimerForTurnExpire = function(enemyID){
        Turn.clearTimerForTurnExpire(enemyID);
        var time = TURN_TIMEOUT_S;
        var interval = setInterval(function(){
            $("#" + enemyID + " .player_countdown")
                .html(s2mmss(time) + " til turn expires")
            time--
        }, 1000);
        _timersForTurnExpire[enemyID] = interval
    }

    Turn.clearTimerForTurnExpire = function(enemyID){
        clearInterval(_timersForTurnExpire[enemyID])
    }

    Turn.extendCountDownTilNewTurn = function(enemyID, timeout){
        Turn.clearTimerForTurnExpire(enemyID)
        Turn.startTimerForNewTurnRequest(enemyID, timeout)
    }

    Turn.countDownTilNewTurn = function(enemyID){
        Turn.clearTimerForTurnExpire(enemyID)
        Turn.startTimerForNewTurnRequest(enemyID)
        Turn.startTimerForNewTurn(enemyID)
    }

    Turn.countDownTilTurnExpires = function(enemyID){
        Turn.clearTimerForNewTurnRequest(enemyID)
        Turn.clearTimerForNewTurn(enemyID)
        Turn.startTimerForTurnExpire(enemyID)
    }

    return Turn
}())

var Sock = (function(){
    var Sock = {}

    var _sock = null
    var _socketAutoReconnectTimeout = null

    Sock.init = function(){
        _sock = new SockJS('http://localhost:8080/sock');

        _sock.onopen = function() {
            msg.info("Opening socket connection")
            clearTimeout(_socketAutoReconnectTimeout)
        };

        // re.data should always be an obj and contain a channel
        // (e.g. move, turn, er)
        _sock.onmessage = function(re){
            try {
                var data = JSON.parse(re.data)
            } catch (e){
                if (re) return msg.error(re.data)
                else return msg.error("FATAL ERROR. Server socket response")
            }
            Game.on[data.chan](data)
        };

        _sock.onclose = function() {
            msg.warning("Losing socket connection. Retrying in 5s...")
            setTimeout(function(){
                Sock.init()
            }, 5000)
        };
    }

    Sock.send = function(chan, data){
        data.chan = chan
        _sock.send(JSON.stringify(data))
    }

    return Sock
}())

var Select = (function(){
    var Select = {}

    var _isSelecting
    var _raycaster
    var _mouse
    var _selected

    Select.init = function(){
        _isSelecting = false
        _raycaster = new THREE.Raycaster();
        _mouse = new THREE.Vector2();
    }

    Select.getIntersect = function(clientX, clientY){
        _mouse.set( ( clientX / window.innerWidth ) * 2 - 1, - ( clientY / window.innerHeight ) * 2 + 1 );
        _raycaster.setFromCamera(_mouse, Scene.camera);
        return _raycaster.intersectObjects(Obj.getAll())[0];
    }

    Select.select = function(clientX, clientY){
        var intersect = Select.getIntersect(clientX, clientY)
        if (!intersect) return
        if (_isSelecting){
            Game.move(_selected,
                      new THREE.Vector3()
                      .copy(intersect.point)
                      .add(new THREE.Vector3()
                           .copy(intersect.face.normal)
                           .multiplyScalar(0.5))) // normal's unit length so gotta scale by half to fit inside the box
            _isSelecting = false
        } else { // start selecting
            if (Player.objBelongsToPlayer(intersect.object)){
                _selected = intersect.object
                Obj.highlight(intersect.object, true)
                Move.highlightAvailableMoves(intersect.object)
                _isSelecting = true
            } else {
                Obj.highlight(_selected, false)
                _isSelecting = false
            }
        }
    }

    Select.getSelected = function(){
        return _selected
    }

    return Select
}())

var Rollover = (function(){
    var Rollover = {}

    var ROLLOVER_MATERIAL = new THREE.MeshLambertMaterial({color:0xffffff, shading:THREE.FlatShading, opacity:0.3, transparent:true})
    var ROLLOVER_GEOMETRY = new THREE.BoxGeometry(K.CUBE_SIZE + 0.01, K.CUBE_SIZE + 0.01, K.CUBE_SIZE + 0.01) // 0.01 extra to prevent highlight from clipping with cube surface
    var _rollover = null

    Rollover.init = function(){
        _rollover = new THREE.Mesh(ROLLOVER_GEOMETRY, ROLLOVER_MATERIAL);
        Rollover.hide()
        Scene.add(_rollover)
    }

    Rollover.getMesh = function(){
        return _rollover
    }

    Rollover.hide = function(){
        Obj.move(_rollover, new THREE.Vector3(0, 0, -1000)) // just move the rollover out of sight
    }

    // ref.
    Rollover.setColor = function(color){
        if (color == null) _rollover.material.color.setRGB(1, 0, 0)
        else _rollover.material.color = color
    }

    function onDocumentMouseMove( event ) {
        event.preventDefault();
        var intersect = Select.getIntersect(event.clientX, event.clientY)
        if (intersect) {
            Obj.move(Rollover.getMesh(), new THREE.Vector3().copy(intersect.point).add(intersect.face.normal))
        }
        Scene.render();
    }

    return Rollover
}())

var Highlight = (function(){
    var Highlight = {}

    var HIGHLIGHT_MATERIALS = {
        red: new THREE.MeshLambertMaterial({color:0xFF4D4D, shading:THREE.FlatShading, opacity:0.8, transparent:true}),
        // green: new THREE.MeshLambertMaterial({color:0x00ff00, shading:THREE.FlatShading, opacity:0.5, transparent:true}),
        green: new THREE.MeshLambertMaterial({color:0x66FF66, shading:THREE.FlatShading, opacity:0.7, transparent:true}),
    }
    var HIGHLIGHT_GEOMETRY = new THREE.BoxGeometry(K.CUBE_SIZE + 0.01, K.CUBE_SIZE + 0.01, 0.01)

    Highlight.COLORS = {
        red: "red",
        green: "green",
    }

    var _highlights = {
        red: [],
        green: [],
    }

    Highlight.highlightCells = function(moves){
        for (var i = 0; i < moves.length; i++){
            var move = moves[i]
            var position = move.xyz
            var color = move.kill ? "red" : "green"
            var highlight = _highlights[color][i] || Highlight.makeHighlight(color)
            highlight.visible = true
            Obj.move(highlight, new THREE.Vector3(position.x, position.y, position.z))
            highlight.position.z -= 0.49
        }
    }

    Highlight.makeHighlight = function(color){
        var highlight = new THREE.Mesh(HIGHLIGHT_GEOMETRY, HIGHLIGHT_MATERIALS[color]);
        Scene.add(highlight)
        _highlights[color].push(highlight)
        return highlight
    }

    Highlight.hideHighlights = function(color){
        for (var i = 0; i < _highlights[color].length; i++){
            _highlights[color][i].visible = false
        }
    }

    Highlight.hideAllHighlights = function(){
        for (var color in Highlight.COLORS) {
            if (Highlight.COLORS.hasOwnProperty(color)){
                Highlight.hideHighlights(color)
            }
        }
    }

    return Highlight
}())

var Player = (function(){
    var Player = {}

    var _player = null

    Player.init = function(done){
        API.Player.get({}, function(er, re){
            if (er) return done(er)
            _player = re.player
            done(null, re)
        })
    }

    Player.getPlayer = function(){
        return _player
    }

    Player.objBelongsToPlayer = function(obj){
        if (!obj.game || !obj.game.piece) return false
        else return Player.isFriendly(obj.game.piece)
    }

    // Object materials are indexed by 0:ENEMY 1:FRIENDLY
    Player.isFriendly = function(piece){
        if (piece.player == _player._id) return 1
        else return 0
    }

    return Player
}())

var Obj = (function(){
    var Obj = {}

    var TEXTURES_ROOT = "/static/images/small/"
    // dummy origin and direction, near==0, far==1 because we only
    // want to find the ground adjacent to an obj
    var _groundRaycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(), 0, 1)
    var _objects = []

    Obj.KIND = {
        ground0: {
            material: new THREE.MeshPhongMaterial({color:0xffffff, shading:THREE.FlatShading, side:THREE.DoubleSide, reflectivity:0.5}),
        },
        ground1: {
            material: new THREE.MeshPhongMaterial({color:0xb78e5d, shading:THREE.FlatShading, side:THREE.DoubleSide, reflectivity:0.5}),
        },
    }

    function loadFaceTextures(textureName, otherFacesColor){
        var materials = []
        for (var i = 0; i < 6; i++){
            materials.push(new THREE.MeshPhongMaterial({color:otherFacesColor, shading:THREE.FlatShading, side:THREE.DoubleSide}))
        } // use colors for non image faces
        materials[4] = new THREE.MeshLambertMaterial({
            map:THREE.ImageUtils.loadTexture(TEXTURES_ROOT + textureName + "4.png", {}, function(){
                Scene.render()
            })
        })
        return materials
    }

    Obj.init = function(){
        var pieces = ["pawn", "rook", "knight", "bishop", "queen", "king"]
        for (var i = 0; i < pieces.length; i++){
            var piece = pieces[i]
            Obj.KIND[piece] = {
                material: [
                    new THREE.MeshFaceMaterial(loadFaceTextures("p0" + piece, 0xff4545)),
                    new THREE.MeshFaceMaterial(loadFaceTextures("p1" + piece, 0x0060ff)),
                ],
            }
        }
    }

    Obj.loadQuadrant = function(x, y, done){
        API.Pieces.get({x:x, y:y, r:10}, function(er, _pieces){
            if (er && done) return done(er)
            Game.loadPieces(_pieces)
            Scene.render()
            if (done) done(null)
        })
    }

    Obj.getMaterial = function(piece){
        var isFriendly = Player.isFriendly(piece)
        return Obj.KIND[piece.kind].material[isFriendly]
    }

    Obj.make = function(piece){
        var mat = Obj.getMaterial(piece)
        var obj = Obj.makeBox(new THREE.Vector3(piece.x, piece.y, 1), mat)
        obj.game = {
            piece: piece,
        }
        return obj
    }

    Obj.move = function(obj, point){
        obj.position
            .copy(point)
            .divideScalar( K.CUBE_SIZE ).floor()
            .multiplyScalar( K.CUBE_SIZE )
            .addScalar( K.CUBE_SIZE / 2 );
    }

    Obj.highlight = function(obj, isHigh){
        if (!obj) return
        if (isHigh) Obj.move(Rollover.getMesh(), obj.position)
        else Rollover.hide()
    }

    Obj.makeBox = function(position, material){
        var box = new THREE.Mesh(K.CUBE_GEO, material);
        box.position.copy(position);
        box.position.divideScalar( K.CUBE_SIZE ).floor().multiplyScalar( K.CUBE_SIZE ).addScalar( K.CUBE_SIZE / 2 );
        box.castShadow = true;
        box.receiveShadow = true;
        return box
    }

    // todo. Store objs in dictionary for faster get
    Obj.findObjAtPosition = function(x, y, z){
        for (var i = 0; i < _objects.length; i++){
            var obj = _objects[i]
            var X = Math.floor(obj.position.x)
            var Y = Math.floor(obj.position.y)
            var Z = Math.floor(obj.position.z)
            // need to check that obj.game exists, cause ground planes
            // don't have that and we don't want ground planes
            if (X == x && Y == y && Z == z && obj.game) return obj
        }
        return null
    }

    Obj.findObjsByPlayerID = function(playerID){
        return _objects.filter(function(obj){
            return (obj.game && obj.game.piece &&
                    obj.game.piece.player == playerID)
        })
    }

    Obj.getAll = function(){
        return _objects
    }

    Obj.add = function(obj){
        _objects.push(obj)
    }

    Obj.remove = function(obj){
        _objects.splice(_objects.indexOf(obj), 1);
    }

    Obj.get = function(index){
        return _objects[index]
    }

    return Obj
}())

var Map = (function(){
    var Map = {}

    var _map = []

    Map.init = function(x, y){
        Map.addMouseDragListener(function(){
            var X = Scene.camera.position.x
            var Y = Scene.camera.position.y
            Map.loadQuadrants(X, Y)
        })
        Map.loadQuadrants(x, y) // load map wherever player spawns
    }

    // obj = {x:asdf, y:asdf, z:asdf}
    Map.add = function(obj){
        _map.push(obj)
    }

    Map.getMap = function(){
        return _map
    }

    Map.addMouseDragListener = function(handler){
        var isDragging = false;
        $(document).mousedown(function() {
            isDragging = false;
        }).mousemove(function() {
            isDragging = true;
        }).mouseup(function() {
            var wasDragging = isDragging;
            isDragging = false;
            if (wasDragging) {
                handler()
            }
        });
    }

    // keys are string representations of arrays, e.g. a[[1,2]] ==
    // "asdf" means a = {"1,2":"asdf"}
    Map.knownQuadrants = {}

    // x and y are real game coordinates
    Map.loadQuadrants = function(x, y){
        // also load the 8 neighbouring quadrants to x, y
        for (var i = -1; i <= 1; i++){
            for (var j = -1; j <= 1; j++){
                var X = Math.floor((x + i * K.QUADRANT_SIZE) / K.QUADRANT_SIZE) * K.QUADRANT_SIZE
                var Y = Math.floor((y + j * K.QUADRANT_SIZE) / K.QUADRANT_SIZE) * K.QUADRANT_SIZE

                if (Map.knownQuadrants[[X, Y]]) continue // Check if we already rendered this quadrant
                else Map.knownQuadrants[[X, Y]] = true

                Map.loadQuadrant(X, Y)
                Obj.loadQuadrant(X, Y, function(er){
                    if (er) msg.error(er)
                })
            }
        }
    }

    // X and Y are game units rounded to nearest multiple of QUADRANT_SIZE
    Map.loadQuadrant = function(X, Y){
		var geometry = new THREE.Geometry();
		for ( var i = 0; i < K.QUADRANT_SIZE; i++){
			geometry.vertices.push(new THREE.Vector3(X + i,               Y + 0,               1));
			geometry.vertices.push(new THREE.Vector3(X + i,               Y + K.QUADRANT_SIZE, 1));
			geometry.vertices.push(new THREE.Vector3(X + 0,               Y + i,               1));
			geometry.vertices.push(new THREE.Vector3(X + K.QUADRANT_SIZE, Y + i,               1));
		}
		var material = new THREE.LineBasicMaterial( { color: 0xffffff, opacity: 0.2, transparent: true } );
		var line = new THREE.Line( geometry, material, THREE.LinePieces );

        Scene.add(line);

        // add thicker lines around the edges
        geometry = new THREE.Geometry()
        geometry.vertices.push(new THREE.Vector3(X + 0,               Y + 0,               1));
        geometry.vertices.push(new THREE.Vector3(X + 0,               Y + K.QUADRANT_SIZE, 1));
        geometry.vertices.push(new THREE.Vector3(X + K.QUADRANT_SIZE, Y + K.QUADRANT_SIZE, 1));
        geometry.vertices.push(new THREE.Vector3(X + K.QUADRANT_SIZE, Y + 0,               1));
        material = new THREE.LineBasicMaterial({color: 0xffffff, opacity: 0.2, transparent:true});
        line = new THREE.Line( geometry, material, THREE.LineStrip );

        Scene.add(line);

        // todo. checker board pattern so you can see better
        geometry = new THREE.PlaneBufferGeometry(K.QUADRANT_SIZE, K.QUADRANT_SIZE);
        material = new THREE.MeshBasicMaterial({color:0x7B84A8});
        // material = new THREE.MeshBasicMaterial({color:0x7B84A8, transparent:true, opacity:0.5});
		plane = new THREE.Mesh(geometry, material);
		plane.visible = true;
        plane.receiveShadow = true;
        plane.position.set(X + K.QUADRANT_SIZE / 2, Y + K.QUADRANT_SIZE / 2, 1)

        Game.addObj(plane)

        Scene.render()
    }

    return Map
}())

var Move = (function(){
    var Move = {}

    Move.range = {
        pawn: 1,
        rook: 6,
        bishop: 6,
        queen: 6,
        king: 1,
        knight: 1,
    }

    Move.directions = {
        ioo: [ 1,  0,  0],
        oio: [ 0,  1,  0],
        iio: [ 1,  1,  0],
        noo: [-1,  0,  0],
        ono: [ 0, -1,  0],
        nio: [-1,  1,  0],
        ino: [ 1, -1,  0],
        nno: [-1, -1,  0],
        // knight moves
        ii2: [ 1,  2,  0],
        i2i: [ 2,  1,  0],
        i2n: [ 2, -1,  0],
        in2: [ 1, -2,  0],
        nn2: [-1, -2,  0],
        n2n: [-2, -1,  0],
        n2i: [-2,  1,  0],
        ni2: [-1,  2,  0],
    }

    // don't allow moving in z axis
    Move.rules = {
        moves: {
            pawn: ["ioo", "oio", "noo", "ono"], // moving along axes
            rook: ["ioo", "oio", "noo", "ono"],
            knight: ["ii2", "i2i", "i2n", "in2", "nn2", "n2n", "n2i", "ni2"],
            bishop: ["iio", "ino", "nno", "nio"],
            king: [
                "ioo", "oio", "noo", "ono", // horizontally and vertically
                "iio", "ino", "nno", "nio", // diagonally
            ],
            queen: [
                "ioo", "oio", "noo", "ono", // horizontally and vertically
                "iio", "ino", "nno", "nio", // diagonally
            ],
        },
        kills: {
            pawn: ["iio", "nio", "ino", "nno"], // diagonal kills
            rook: ["ioo", "oio", "noo", "ono"],
            knight: ["ii2", "i2i", "i2n", "in2", "nn2", "n2n", "n2i", "ni2"],
            bishop: ["iio", "ino", "nno", "nio"],
            king: [
                "ioo", "oio", "noo", "ono", // horizontally and vertically
                "iio", "ino", "nno", "nio", // diagonally
            ],
            queen: [
                "ioo", "oio", "noo", "ono", // horizontally and vertically
                "iio", "ino", "nno", "nio", // diagonally
            ],
        },
    }

    // Store currently available moves once player clicks a piece to
    // move. Each item contains position and a direction, whether it's
    // a kill move or not, etc. Useful for sending to server to
    // validate when player moves.
    Move.validatedMoves = []

    Move.highlightAvailableMoves = function(obj){
        var moves = Move.findAvailableMoves(obj)
        moves.push.apply(moves, Move.findAvailableKills(obj))
        Highlight.highlightCells(moves)
        Move.validatedMoves = moves.filter(function(item){ // Cache available moves
            return item.kill == false || item.killMove == true // Only interested in actual moveable positions
        })
    }

    Move.findAvailableKills = function(obj){
        var range = Move.getRange(obj.game.piece.kind)
        var killRules = Move.rules.kills[obj.game.piece.kind]
        var moves = []
        for (var i = 0; i < killRules.length; i++){
            var dirMoves = Move.findKillsInDirection(obj, [
                Math.floor(obj.position.x),
                Math.floor(obj.position.y),
                Math.floor(obj.position.z),
            ], Move.directions[killRules[i]], range, [])
            moves.push.apply(moves, dirMoves)
        }
        return moves
    }

    Move.findAvailableMoves = function(obj){
        var range = Move.getRange(obj.game.piece.kind)
        var moveRules = Move.rules.moves[obj.game.piece.kind]
        var moves = []
        for (var i = 0; i < moveRules.length; i++){
            var dirMoves = Move.findMovesInDirection(obj, [
                Math.floor(obj.position.x),
                Math.floor(obj.position.y),
                Math.floor(obj.position.z),
            ], Move.directions[moveRules[i]], range, [])
            moves.push.apply(moves, dirMoves)
        }
        return moves
    }

    // recursively find available kill moves
    // return the whole move list if there is a final kill
    // otw return an empty list
    Move.findKillsInDirection = function(obj, from, direction, range, moves){
        if (range == 0) return [] // out of range

        var x = from[0] + direction[0]
        var y = from[1] + direction[1]
        var z = from[2] + direction[2]

        var validMove = Move.validateMove(obj, x, y, z, true) // kill move true
        if (!validMove) return [] // can't move here

        moves.push({
            xyz: validMove.xyz,
            kill: true,
            killMove: validMove.killMove, // the actual kill move, as opposed to intermediate cells
            direction: direction,
        })
        if (validMove.killMove) return moves
        else if (!validMove.more) return [] // can't move past this point
        else return Move.findKillsInDirection(obj, [
            x, y, z
        ], direction, --range, moves) // keep going
    }

    // recursively find available moves
    Move.findMovesInDirection = function(obj, from, direction, range, moves){
        if (range == 0) return moves // out of range

        var x = from[0] + direction[0]
        var y = from[1] + direction[1]
        var z = from[2] + direction[2]

        var validMove = Move.validateMove(obj, x, y, z, false)
        if (!validMove) return moves // can't move here

        moves.push({
            xyz: validMove.xyz,
            kill: false,
            direction: direction,
        })
        if (!validMove.more) return moves // can't move past this point
        else return Move.findMovesInDirection(obj, [
            x, y, z
        ], direction, --range, moves) // keep going
    }

    Move.validateMove = function(obj, x, y, z, isKill){
        var box = Obj.findObjAtPosition(x, y, z)
        if (!box || !box.game){ // empty cell
            return {xyz:{x:x, y:y, z:z}, more:true}
        } else if (box.game.piece.player == obj.game.piece.player){ // blocked by friendly
            return null
        } else if (box && isKill){ // blocked by enemy
            return {xyz:{x:x, y:y, z:z}, more:false, killMove:true}
        } else { // also blocked by enemy but not a kill move
            return null
        }
    }

    // Checks that xyz is in the list of validated moves that we just calculated
    Move.isValidated = function(x, y, z){
        return $.grep(Move.validatedMoves, function(item){
            return item.xyz.x == x && item.xyz.y == y && item.xyz.z == z
        }).length > 0
    }

    Move.getRange = function(objKind){
        return Move.range[objKind]
    }

    return Move
}())

var Scene = (function(){
    var Scene = {
        camera: null
    }

    var _scene = new THREE.Scene();
    var _container
    var _stats;
    var _controls, _renderer;
    var _isShiftDown = false;

    Scene.init = function(x, y){
        initContainer()
        initStats()
        initInfo()
        initLights()
        initCamera(x, y)
        initControls(x, y)
        initListeners()
        initRenderer()

        Rollover.init()
        Select.init()

        Sock.init()

        animate();
        Scene.render();
    }

    Scene.add = function(obj){
        _scene.add(obj)
    }

    Scene.remove = function(mesh){
        _scene.remove(mesh)
    }

    Scene.getScene = function(){
        return _scene
    }

    function initContainer(){
        _container = document.createElement( 'div' );
        document.body.appendChild(_container);
    }

    // NOTE. Need to set TrackballControls's target to x, y, z, otw
    // you get a weird camera lookAt bug. See
    // initControls._controls.target
    function initCamera(x, y){
        Scene.camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 1, 50 );
        Scene.camera.position.z = K.INIT_CAM_POS; // for some reason you need this or track ball controls won't work properly
        Scene.camera.position.x = x
        Scene.camera.position.y = y
    }

    function initControls(x, y){
        _controls = new THREE.TrackballControls(Scene.camera);
        _controls.target = new THREE.Vector3(x, y, 0)
        _controls.rotateSpeed = 2.5;
        _controls.zoomSpeed = 1.5;
        _controls.panSpeed = 1.0;
        _controls.noRotate = true;
        _controls.noZoom = false;
        _controls.noPan = false;
        _controls.staticMoving = true;
        _controls.dynamicDampingFactor = 0.3;
        _controls.keys = [ 65, 83, 68 ];
        _controls.addEventListener('change', Scene.render);
        // adding this makes moving with the mouse really slow
        // document.addEventListener( 'mousemove', _controls.update.bind( _controls ), false ); // this fixes some mouse rotating reeeeeaaaal slow
    }

    function initLights(){
        var ambientLight = new THREE.AmbientLight(0xB080D1);
        Scene.add(ambientLight);
        Scene.add(createDirectionalLight(0, 0, 20));
    }

    function initRenderer(){
        _renderer = new THREE.WebGLRenderer( { antialias:false, alpha:true } );
        _renderer.setClearColor(0x02002B, 1);
        _renderer.setPixelRatio( window.devicePixelRatio );
        _renderer.setSize( window.innerWidth, window.innerHeight );

        _container.appendChild( _renderer.domElement );
    }

    function initListeners(){
        document.addEventListener( 'mousedown', onDocumentMouseDown, false );
        document.addEventListener( 'keydown', onDocumentKeyDown, false );
        document.addEventListener( 'keyup', onDocumentKeyUp, false );
        window.addEventListener( 'resize', onWindowResize, false );
    }

    function initInfo(){
        var info = document.createElement( 'div' );
        info.style.color = "white"
        info.style.position = 'absolute';
        info.style.top = '10px';
        info.style.right = "10px";
        info.style.textAlign = 'right';
        info.innerHTML = '3DXO<br>'
            + "<strong>mouse</strong>: navigate<br>"
            + '<strong>click</strong>: move box<br>'
        _container.appendChild( info );
    }

    function initStats(){
        _stats = new Stats();
        _stats.domElement.style.position = 'absolute';
        _stats.domElement.style.top = '0px';
        _stats.domElement.style.zIndex = 100;
        _container.appendChild( _stats.domElement );
    }

    function onDocumentMouseDown( event ) {
        event.preventDefault();
        if (event.which == 1){ // left mouse button
            Select.select(event.clientX, event.clientY)
            Scene.render()
        } else if (event.which == 2){ // middle mouse
            // using middle
        } else if (event.which == 3){ // right mouse
            // and right mouse buttons for navigation
        }
    }

    function onDocumentKeyDown( event ) {
        switch( event.keyCode ) {
        case 16: _isShiftDown = true; break;
        }
        Scene.render()
    }

    function onDocumentKeyUp( event ) {
        switch ( event.keyCode ) {
        case 16: _isShiftDown = false; break;
        }
    }

    function onWindowResize() {
        Scene.camera.aspect = window.innerWidth / window.innerHeight;
        Scene.camera.updateProjectionMatrix();
        _renderer.setSize( window.innerWidth, window.innerHeight );
        _controls.handleResize();
        Scene.render();
    }

    function animate() {
        requestAnimationFrame( animate );
        _controls.update(); // use this too cause zooming's weird without it
        // Scene.render() // don't render on every frame unless you're really animating stuff
    }

    Scene.render = function(){
        try {
            _renderer.render(_scene, Scene.camera);
            _stats.update();
        } catch (e){
            msg.warning("Renderer not ready", 2)
        }
    }

    function createDirectionalLight(x, y, z){
        var light = new THREE.DirectionalLight(0xFFFB87);
        light.position.set(x, y, z);
        light.intensity = 0.75;
        return light
    }

    return Scene
}())

var Game = (function(){
    var Game = {}

    Game.init = function(done){
        var player, king = null
        var x = y = 0
        async.waterfall([
            function(done){
                Player.init(function(er, re){
                    if (re){
                        king = re.king
                        player = re.player
                    }
                    done(er)
                })
            },
            function(done){
                done(null)
                if (king){
                    x = king.x
                    y = king.y
                }
                Scene.init(x, y)
                Obj.init()
                Map.init(x, y)
                Hud.init(player)
                Turn.init(player)
            },
        ], function(er){
            if (er) msg.error(er)
        })
    }

    Game.move = function(selected, pos){
        var x = Math.floor(pos.x)
        var y = Math.floor(pos.y)
        var z = 1 // height of every game piece
        var player = Player.getPlayer()
        async.waterfall([
            function(done){
                if (Move.isValidated(x, y, z)) done(null)
                else done({code:"INVALID MOVE"})
            },
            function(done){
                done(null)
                Sock.send("move", {
                    playerID: player._id,
                    player: player,
                    piece: selected.game.piece,
                    from: selected.position, // most likely fractions, so need to floor on server:
                    to: pos,
                })
            },
        ], function(er){
            if (er && er.code) msg.error(er.code)
            Obj.highlight(Select.getSelected(), false)
            Highlight.hideAllHighlights()
            Scene.render()
        })
    }

    Game.on = (function(){
        var on = {}

        // Generic error handler
        on.error = function(data){
            if (data.playerID == Player.getPlayer()._id) msg.error(data.er)
        }

        on.move = function(data){
            var you = Player.getPlayer()
            if (isNoMoreTurns(you, data)){
                return msg.error(data.error.info)
            } else if (isGenericSockError(you, data)){
                return
            }

            var playerName = data.player.name
            Game.removeObjAtXY(data.to.x, data.to.y)

            // move selected
            var sel = Obj.findObjAtPosition(Math.floor(data.from.x), Math.floor(data.from.y), 1)
            sel.game.piece = data.piece // update piece with new position data
            data.to.z = 1.5
            Obj.move(sel, data.to)

            Scene.render()
            Turn.update(data.player)
        }

        on.turn = function(data){
            var you = Player.getPlayer()
            if (isTurnRequestEarly(you, data)){
                return Turn.extendCountDownTilNewTurn(data.enemyID, 2000)
            } else if (isGenericSockError(you, data)){
                return
            }
            var enemyID = data.enemy._id
            var your_turn = data.your_turn
            if (isYourSock(you, data)){
                Hud.renderTurns(data.player)
                if (your_turn){ // just got new turn: count down til turn expires
                    Turn.countDownTilTurnExpires(enemyID)
                } else { // just lost turn: count down til new turn
                    Turn.countDownTilNewTurn(enemyID)
                }
            }
        }

        function isYourSock(you, data){
            return (you._id == data.playerID)
        }

        function isGenericSockError(you, data){
            if (isYourOtherErrors(you, data)){
                msg.error(data.error.info)
                return true
            } else if (isOtherPeoplesError(you, data)){
                return true
            }
            return false
        }

        function isNoMoreTurns(you, data){
            return (isYourSock(you, data) && data.error &&
                data.error.code == K.code.turn.none.code)
        }

        function isTurnRequestEarly(you, data){
            return (isYourSock(you, data) && data.error &&
                data.error.code == K.code.turn.timeout.code)
        }

        function isYourOtherErrors(you, data){
            return (isYourSock(you, data) && data.error)
        }

        function isOtherPeoplesError(you, data){
            return (data.error && !isYourSock(you, data))
        }

        on.turn_refresh = function(data){
            var you = Player.getPlayer()
            var player = data.player
            if (isYourSock(you, data)){
                Hud.clearTurns()
                Hud.renderTurns(player)
            }
        }

        // todo big splash screen and menu for loser
        on.gameover = function(data){
            var you = Player.getPlayer()
            var you_win = data.you_win
            if (isYourSock(you, data) && you_win){
                msg.info("YOU WIN!")
            } else if (isYourSock(you, data)){
                msg.error("GAME OVER")
            }
        }

        on.defect = function(data){
            var defectorID = data.defectorID
            var defecteeID = data.defecteeID
            var defectors = Game.removePiecesByPlayerID(defectorID)
            Game.defect(defectors, defecteeID)
            Game.loadPieces(defectors)
        }

        return on
    }())

    // change pieces' playerID to defecteeID
    Game.defect = function(pieces, defecteeID){
        pieces.forEach(function(piece, i){
            piece.player = defecteeID
        })
    }

    // Load pieces
    Game.loadPieces = function(pieces){
        var objs = []
        for (var i = 0; i < pieces.length; i++){
            objs.push(Obj.make(pieces[i]))
        }
        Game.addObjs(objs)
    }

    Game.addObj = function(obj){
        Scene.add(obj);
        Obj.add(obj)
    }

    Game.addObjs = function(objs){
        for (var i = 0; i < objs.length; i++){
            Game.addObj(objs[i])
        }
    }

    // Returns removed obj
    Game.removeObjAtXY = function(x, y){
        var obj = Obj.findObjAtPosition(Math.floor(x), Math.floor(y), 1)
        if (obj && obj.game){
            Scene.remove(obj);
            Obj.remove(obj)
        }
        return obj
    }

    Game.removePiecesByPlayerID = function(playerID){
        var objs = Obj.findObjsByPlayerID(playerID)
        var pieces = objs.map(function(obj){
            Scene.remove(obj);
            Obj.remove(obj)
            return obj.game.piece
        })
        return pieces
    }

    return Game
}())

window.onload = function(){
    if (!Detector.webgl) Detector.addGetWebGLMessage();
    Game.init()
}

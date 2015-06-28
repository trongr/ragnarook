var http       = require("http")
var express    = require('express');
var app        = express();
var logger = require('morgan');
var bodyParser = require('body-parser');
var path = require('path');
var H = require("./lib/h.js")
var Sock = require("./sock.js")
var DB = require("./db.js")
var Cells = require("./api/cells.js")
var Players = require("./api/players.js")

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// cross-origin
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", req.headers.origin) // allows all
    res.header("Access-Control-Allow-Credentials", "true")
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE')
    next()
});

app.use("/static", express.static('static'));

app.get('/', function(req, res){
    res.sendFile(path.join(__dirname + '/static/index.html'))
});

app.use('/api/v1/cell', Cells);
app.use('/api/v1/player', Players);

// production error handler. no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.send('error');
});

var port = process.env.PORT || 8080;
server = http.createServer(app);
server.listen(port);
Sock.init(server)
console.log('Magic happens on port ' + port);

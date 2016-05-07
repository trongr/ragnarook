var mongoose = require('mongoose');
var DB = require("../db.js")
var H = require("../static/js/h.js")
var K = require("../api/k.js")

// todo index data.pieceID for automove job lookup
var schema = mongoose.Schema({
    task: {type: String},
    created: {
        type: Date, default: Date.now,
        expires: 7 * 24 * 60 * 60, // in seconds
        // IMPORTANT.
        // IMPORTANT.
        // IMPORTANT. documents expire after 7 days so you can't
        // schedule jobs to run more than 7 days into the future. if
        // you need to do that use mongoose's expireAt feature
        //
        // NOTE. if you change expires, you have to drop the index in
        // mongo, otw it'll stay the same in the db. use:
        // db.jobs.dropIndex('created_1'). to see a list of indices,
        // use: db.jobs.getIndexes()
    },
    modified: {type: Date, default: Date.now},
    status: { type: String, default:"new"}, // new, working, cancelled, done, error. see api/k.js
    data: {type: mongoose.Schema.Types.Mixed}
});

schema.statics.findOneByID = function(jobID, done){
    this.findById(jobID, function(er, job){
        if (job) done(null, job)
        else done(["ERROR. Job.findOneByID", jobID, er])
    })
};

schema.statics.cancelJob = function(query, done){
    this.update(query, {
        $set: {
            status: K.job.cancelled,
            modified: new Date(), // need this cause update bypasses mongoose's pre save middleware
        },
    }, {
        multi: true
    }, function(er, num){
        done(er, num)
    })
};

schema.statics.checkJobCancelled = function(jobID, done){
    this.findOneByID(jobID, function(er, job){
        if (er){
            var error = ["ERROR. Job.findOneByID", jobID, er]
        } else if (job && job.status == K.job.cancelled){
            var error = "INFO. Job.findOneByID: cancelled: " + jobID
        } else if (job){
            var error = null
        } else {
            var error = ["ERROR. Job.findOneByID: job not found", jobID]
        }
        done(error, job)
    })
}

schema.statics.cancel_delay_remove_army = function(playerID, done){
    H.p("Job.cancel_delay_remove_army", playerID)
    this.update({
        "task": "remove_army",
        "data.playerID": playerID,
        "data.army_alive": true // only let player cancel
        // remove_army jobs, i.e. reclaim
        // their army if it's still alive
    }, {
        $set: {
            status: K.job.cancelled,
            modified: new Date(), // need this cause update bypasses mongoose's pre save middleware
        },
    }, {
        multi: true
    }, function(er, num){
        if (er) var error = ["ERROR. Job.cancel_delay_remove_army", playerID, er]
        if (done) done(error)
        else if (error) H.p("Job.cancel_delay_remove_army", playerID, error)
    })
}

schema.statics.cancel_delay_remove_anonymous_player = function(playerID, done){
    H.p("Job.cancel_delay_remove_anonymous_player", playerID)
    this.update({
        "task": "remove_anonymous_player",
        "data.playerID": playerID,
    }, {
        $set: {
            status: K.job.cancelled,
            modified: new Date(), // need this cause update bypasses mongoose's pre save middleware
        },
    }, {
        multi: true
    }, function(er, num){
        if (er) var error = ["ERROR. Job.cancel_delay_remove_anonymous_player", playerID, er]
        if (done) done(error)
        else if (error) H.p("Job.cancel_delay_remove_anonymous_player", playerID, error)
    })
}

module.exports = mongoose.model('Job', schema);

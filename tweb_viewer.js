/**
 * Module dependencies.
*/
var http        = require("http");
var express = require('./node_modules/express');
var hash = require('./pass').hash;
var bodyParser = require('./node_modules/body-parser');
var EventEmitter = require('./node_modules/events').EventEmitter;
var session = require('./node_modules/express-session');
var io = require('./node_modules/socket.io');
//var python = require('node-python');
//var utils = require('./utils');
var spawn = require("child_process").spawn;
var PythonShell = require('python-shell');

//var app = module.exports = express();
var app = express();
var server = http.createServer(app).listen(4000, function(){
  console.log('Express server listening on port 4000');
});

// config

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use("/styles",express.static(__dirname + "/styles"));
app.use("/src",express.static(__dirname + "/src"));
app.use("/icons",express.static(__dirname + "/icons"));
app.use("/images",express.static(__dirname + "/images"));

// middleware

app.use(bodyParser.urlencoded({ extended: false }));
app.use(session({
  resave: false, // don't save session if unmodified
  saveUninitialized: false, // don't create session until something stored
  secret: 'shhhh, very secret'
}));

// Session-persisted message middleware

app.use(function(req, res, next){
  var err = req.session.error;
  var msg = req.session.success;
  delete req.session.error;
  delete req.session.success;
  res.locals.message = '';
  if (err) res.locals.message = '<p class="msg error">' + err + '</p>';
  if (msg) res.locals.message = msg;
  next();
});

// dummy database

var users = {
  tj: { name: 'tj' }
};

// when you create a user, generate a salt
// and hash the password ('foobar' is the pass here)

hash('foobar', function(err, salt, hash){
  if (err) throw err;
  // store the salt & hash in the "db"
  users.tj.salt = salt;
  users.tj.hash = hash;
});


var md5 = require('MD5');
// Make Connection and return connection object!
function get_db_mysql_conn() {
    var mysql =  require('mysql');
    var ini = require('node-ini');
    var cfg = ini.parseSync('./config.ini');
    var vhost = cfg['dbconn']['host'];
    var vuser = cfg['dbconn']['user'];
    var vpassword = cfg['dbconn']['password'];
    var vdbname = cfg['dbconn']['dbname'];
    var connection =  mysql.createConnection({
        host : vhost,
        user : vuser,
        password: vpassword,
        database : vdbname
        });
    return connection
}
// Authenticate using our plain-object database of doom!
function authenticate(name, pass, fn) {
    var user_name = name;
    var password = pass;
    var connection = get_db_mysql_conn();
    connection.connect();
    var strQuery = "select * from user_mgmt where login_id ='"+user_name+"' and user_passwd ='"+password+"'";
    connection.query( strQuery, function(err, rows){
        if(err) {
            throw err;
        }else{
            if(rows.length == 0){
               fn(new Error('cannot find user')); 
            }else if(rows.length == 1){
                return fn(null, rows[0]);
            }
        }

    });
    connection.end();
}
function get_url_mgmt(callback) {
    var table_content2 =''
    var connection = get_db_mysql_conn();
    connection.connect();
    var strQuery = "select url_id,url_name,v2_prof_count,v1_prof_count from url_mgmt where v2_prof_count !='NULL' order by v2_prof_count DESC";
    connection.query( strQuery, function(err, rows){
        if(err) {
            callback(err);  
            console.log(err); 
        }
        callback(rows);
    });
    connection.end();
}

function restrict(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    req.session.error = 'Access denied!';
    res.redirect('/login');
  }
}

app.get('/', function(req, res){
  res.redirect('/login');
});

app.get('/restricted', restrict, function(req, res){
  res.send('Wahoo! restricted area, click to <a href="/logout">logout</a>');
});

app.get('/logout', function(req, res){
  // destroy the user's session to log them out
  // will be re-created next request
  req.session.destroy(function(){
    res.redirect('/');
  });
});

app.get('/login', function(req, res){
  res.render('login');
});
var taxo_name_mapping = {};
var json_data = {project_id:4};
var process = spawn('python',["./python_src/cgi_getdata_service_interface.py", JSON.stringify(json_data)]); 
//console.log('==='+"./python_src/cgi_getdata_service_interface.py "+JSON.stringify(json_data));
process.stdout.on('data', function (json){
    taxo_name_mapping = utils.store_default_taxos_new(JSON.parse(json)); 
})
app.get('/host', function(req, res){
  if (req.session && req.session.user) {
    authenticate(req.session.user.login_id, req.session.user.user_passwd, function(err, user){
        if (user) {
            var table_content = '';
            table_content0 = '<tr class="table-header-row"><th class="table_header" width="5%">Url Id.</th><th class="table_header" width="80%">Url Name</th><th class="table_header" width="10%">V2 Profile Count</th><th class="table_header" width="5%">V1 Profile Count</th></tr>';
            get_url_mgmt(function(results) {
                if ( results ) { 
                    var table_content1 =''
                    for (var i = 0; i < results.length; i++) {
                        table_content1 = table_content1 + '<tr class=""><td class="table_cells">'+results[i].url_id+'</td><td class="table_cells">'+results[i].url_name+'</td><td class="table_cells">'+results[i].v2_prof_count+'</td><td class="table_cells">'+results[i].v1_prof_count+'</td></tr>'
                    };
                    table_content = table_content0 + table_content1
                    res.render('host', {message:table_content});
                }
            });
        }else{
            res.redirect('/login');
        }
    });
  }else{
    res.redirect('/login');
  }
});

app.get('/url_list', function(req, res){
  if (req.session && req.session.user) {
    authenticate(req.session.user.login_id, req.session.user.user_passwd, function(err, user){
        if (user) {
            if (req.session.host){
                var options = {
                       mode: 'json',
                       pythonPath: 'python',
                       pythonOptions: [],
                       scriptPath: './python_src',
                       args: [4, 21]
                };
                //console.log('Path : '+json.src + " " + JSON.stringify(json.data));
                //var process = spawn('python',["./python_src/cgi_get_user_urls.py", 4, 21]);
                try{
                PythonShell.run('cgi_get_user_urls.py', options, function (err, jsondata) {
                    if (err) throw err;
                    var json = jsondata[0];
                //console.log(process);
                    //process.stdout.on('data', function (json){
                        //console.log('DATA : '+JSON.stringify(json)); 
                        //var data	= JSON && JSON.parse(json) || eval(json);
                        var data = json;
                        //var data = JSON.parse(json);
                        var keys    = Object.keys(data);
                        keys.sort();
                        var batch_content = "";
                        for (var index in keys){
                            var value = keys[index];
                            data[value]['batch_id'] = value;
                            batch_content += '<option value="'+value+'" custom_data="'+JSON.stringify(data[value])+'">'+data[value]['batch_name']+'</option>'
                        }
                        var url_lists   = data[keys[0]].url_info;
                        var table_rows = ""
                        for (var index in url_lists){
                            var arr = url_lists[index]; 
                            var json_data   = {batch_id:data['batch_id'], url_info:arr};
                            table_rows += '<tr custom_data="'+JSON.stringify(json_data)+'" onclick="TASApp.URL.url_row_select(this, event);">'
                            table_rows += '<td class="table_cells">'+(parseInt(index) + 1)+'</td>'
                            table_rows += '<td class="table_cells">'+arr['adate']+'</td>'
                            table_rows += '<td class="table_cells">'+arr['agent_id']+'</td>'
                            table_rows += '<td class="table_cells">'+arr['url_id']+'</td>'
                            table_rows += '<td class="table_cells">'+utils.get_mgnt_pages(arr['url_name'], arr['mgmt_pages'], arr['agent_id'], arr['url_id'])+'</td>'
                            table_rows += '<td class="table_cells">'+utils.get_mgnt_pages(arr['home_page'], arr['mgmt_pages'], arr['agent_id'], arr['url_id'], true,arr['url_status'])+'</td>'
                            table_rows += '<td class="table_cells"><img src="images/process.png" width="20" height="20" class="load_url" /></td>'
                            table_rows += '<td class="table_cells"><img class="remove-url" src="images/delete_x.png" width="20" height="20" /></td>'
                            table_rows += '</tr>'
                        }
                        res.render('url_list', {'select_batch': batch_content, 'table_rows':table_rows});
                    });
                }catch(e){}
            }
        }else{
            res.redirect('/login');
        }
    });
  }else{
        res.redirect('/login');
  }
});

app.get('/mgmt', function(req, res){
  if (req.session && req.session.user) {
    authenticate(req.session.user.login_id, req.session.user.user_passwd, function(err, user){
        if (user) {
            req.session.url_id    = req.query.url_id;
            req.session.agent_id  = req.query.agent_id;
            req.session.doc_id    = req.query.doc_id;
            req.session.mgmt_id   = req.query.mgmt_id;
            req.session.user_id   = 21;
            req.session.project_id = 4;
            req.session.user_name = user['user_name'];
            req.session.user_role = user['user_role'];
            req.session.success = "Selected host IP"+req.session.host+"====U"+req.session.url_id+"===A"+req.session.agent_id+"===D"+req.session.doc_id+"===M"+req.session.mgmt_id+"====U"+req.session.user.user_id;
            res.redirect('/tabs');
        }else{
            res.redirect('/login');
        }
    });
  }else{
        res.redirect('/login');
  }
});
var reciver = function(json){
     console.log('hhhhhh'+JSON.stringify(json))
     var socket1 = this;
     var address = socket1.request.headers['x-forwarded-for'] || socket1.request.connection.remoteAddress;
     var port = socket1.request.headers['x-forwarded-port'] || socket1.request.connection.remotePort;
     if (json){
        console.log("rec : "+address+':'+socket1.id+":"+JSON.stringify(json))
        var options = {
                       mode: 'json',
                       pythonPath: 'python',
                       pythonOptions: [],
                       scriptPath: './python_src',
                       args: [JSON.stringify(json.data)]
                     };
        //console.log('Path : '+json.src + " " + JSON.stringify(json.data));
        PythonShell.run(json.src, options, function (err, data) {
            if (err) throw err;
            console.log("send : "+address+':'+socket1.id+":"+JSON.stringify(json)+':'+JSON.stringify(data[0]))
            socket1.emit(socket1.id, data[0]);
        });
    }
}

app.get('/tabs', function(req, res){
  if (req.session && req.session.user) {
    authenticate(req.session.user.login_id, req.session.user.user_passwd, function(err, user){
        if (user) {
            if (req.session.host){
                if (req.session.url_id && req.session.agent_id && req.session.doc_id && req.session.mgmt_id){
                    var io_obj  = io.listen(server);
                    io_obj.sockets.on('connection', function(socket){
                        console.log('connection started...'+socket.id);
                        var json_data = {project_id:req.session.project_id, user_id:req.session.user_id, host_id:req.session.host, batch_id:1, login_id:req.session.login_id, user_name:req.session.user_name, user_role:req.session.user_role, agent_id:req.session.agent_id, mgmt_id:Number(req.session.mgmt_id), url_id:Number(req.session.url_id), doc_id:req.session.doc_id,taxo_mapping:taxo_name_mapping,prev_ref:0}
                        console.log('gbl_data : '+JSON.stringify(json_data));
                        socket.emit("gbl_data",json_data);
                        console.log('yes'+socket.id);
                        socket.on(socket.id, reciver);
                        socket.on('disconnect', function(){
                            console.log('Request for socket disconnect'+socket.id);
                            socket.removeListener('connection', reciver);
                        });
                    });
                    res.render('tabs',{'address':req.session.host});
                }else{
                    res.redirect('/url_list');
                }
            }else{
                    res.redirect('/host');
            }
        }else{
            res.redirect('/login');
        }
    });
  }else{
        res.redirect('/login');
  }
});



app.get('/url', function(req, res){
  if (req.session && req.session.user) {
    authenticate(req.session.user.login_id, req.session.user.user_passwd, function(err, user){
        if (user) {
            var host_ip = req.query.host_ip;
            req.session.regenerate(function(){
                req.session.host = host_ip;
                req.session.user = user;
                req.session.success = "Selected host IP"+host_ip;
                res.redirect('/url_list');
                //res.redirect('http://effbot.org/zone/python-for-statement.htm');
            });
        }else{
            res.redirect('/login');
        }
    });
  }else{
        res.redirect('/login');
  }
});


app.post('/login', function(req, res){
  authenticate(req.body.username, md5(req.body.password), function(err, user){
    if (user) {
      // Regenerate session when signing in
      // to prevent fixation
      req.session.regenerate(function(){
        // Store the user's primary key
        // in the session store to be retrieved,
        // or in this case the entire user object
        req.session.user = user;
        //req.session.success = table_content;
        res.redirect('/host');
      });
    } else {
      req.session.error = 'Authentication failed'
      res.redirect('/login');
    }
  });
});

/* istanbul ignore next */
/*if (!module.parent) {
  app.listen(3000);
  console.log('Express started on port 3000');
}*/



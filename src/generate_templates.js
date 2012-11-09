var fs       = require('fs'),
    shell    = require('shelljs'),
    readdirp = require('readdirp'),
    et       = require('elementtree'),
    path     = require('path');

// show this number of the most recent commits in lib's histories
var num_commits_to_show = 20;

// location of platform libraries
var libDir = path.join(__dirname, '..', 'lib');
var libraries = fs.readdirSync(libDir);

// where we store mobile-spec results
var posts = path.join(__dirname, '..', 'posts');

// html template for the dashboard
var html = '<html><head></head><body><h1>ghetto cordova dashboard</h1>';
html    += '<h2>cordova-android</h2>';
html    += '{android}';
html    += '<h2>cordova-ios</h2>';
html    += '{ios}';
html    += '</body></html>';

var libShas = {};
var libResults = {};

function update_commit_list(lib) {
    if (lib == 'incubator-cordova-mobile-spec') return;
    var libPath = path.join(libDir, lib);
    var commitList = shell.exec('cd ' + libPath + ' && git rev-list --all --pretty=oneline --max-count=' + num_commits_to_show, {silent:true});
    if (commitList.code > 0) throw ('Failed to get commit list for ' + lib + ' library.');
    var commitArr = commitList.output.split('\n');
    commitArr = commitArr.slice(0, commitArr.length - 1);
    var shaRegExp = /^([a-z0-9]+)\s+/;
    var shaList = commitArr.map(function(c) {
        var res = shaRegExp.exec(c);
        if (res) return res[1];
    });
    libShas[lib] = shaList;
}

// initialize from written xml
// get repository commit lists
libraries.forEach(update_commit_list);

// Identify which commits have test results
fs.readdir(posts, function(err, platforms) {
    if (err) throw ('Could not read posts directory (' + posts + ')');
    platforms.forEach(function(platform) {
        var libName = 'incubator-cordova-' + platform.toLowerCase();
        var resDir = path.join(posts, platform);
        fs.readdir(resDir, function(err, resultsBySha) {
            if (err) throw ('Could not read results lib directory (' + resDir + ')');
            resultsBySha.forEach(function(sha) {
                var testDir = path.join(resDir, sha);
                // recursively read test dirs and grab xml
                var entryStream = readdirp({
                    root:testDir,
                    fileFilter:'*.xml'
                }).on('data', function(entry) {
                    var version = entry.path.substr(0, entry.path.indexOf('/'));
                    var model = entry.name.substr(0, entry.name.indexOf('_'));
                    fs.readFile(entry.fullPath, 'utf-8', function(e, data) {
                        if (e) throw ('Could not read result file ' + entry.fullPath);
                        update_specific_template(platform, sha, version, model, data);
                    });
                });
            });
        });
    });
});

// Create page templates
module.exports = function generate_templates(platform, sha, version, model, xml) {
    if (arguments.length === 0) {
        // drop results into the html template and return html
        var table = create_results_table(html, libShas, libResults);
        return interpolate_template(html, table);
    } else {
        // update a specific part of the template
        update_specific_template(platform, sha, version, model, xml);
    }
};

function update_specific_template(platform, sha, version, model, xmlData) {
    var xml = new et.ElementTree(et.XML(xmlData));
    var tests = 0, num_fails = 0, time = 0;
    xml.getroot().findall('testsuites').forEach(function(set) {
        set.getchildren().forEach(function(suite) {
            tests += parseInt(suite.attrib.tests, 10);
            num_fails += parseInt(suite.attrib.failures, 10);
            time += parseFloat(suite.attrib.time);
        });
    });

    // Make sure libResults have proper parent objects
    if (!libResults[platform]) libResults[platform] = {};
    if (!libResults[platform][sha]) {
        libResults[platform][sha] = {};
        // if we don't have the sha it might be a new commit. we may have to update full sha list.
        update_commit_list('incubator-cordova-' + platform);
    }
    if (!libResults[platform][sha][version]) libResults[platform][sha][version] = {};
    if (!libResults[platform][sha][version][model]) libResults[platform][sha][version][model] = {};

    // TODO:failure details 
    libResults[platform][sha][version][model] = {
        tests:tests,
        num_fails:num_fails,
        time:time
    };
    console.log('Template generated');
};

function create_results_table(tmpl, sha_list, results) {
    var data = {
        'android':null,
        'ios':null
    };
    for (var lib in sha_list) if (sha_list.hasOwnProperty(lib)) {
        var platform = lib.substr(18);
        var platform_table = '<table><tr><td colspan="2">recent ' + platform + ' commits</td></tr><tr><td>commit</td><td>test results</td></tr>';
        var recent_shas = sha_list[lib].slice(0, num_commits_to_show);
        recent_shas.forEach(function(sha) {
            platform_table += '<tr><td><a href="http://git-wip-us.apache.org/repos/asf?p=' + lib + '.git;a=commit;h='+sha+'">' + sha.substring(0,7)  + '</a></td><td>';
            if (libResults[platform] && libResults[platform][sha]) {
                var versions = libResults[platform][sha];
                var results_table = '<table><tr><td colspan="3">mobile-spec results</td></tr><tr><td>version</td><td>model/name</td><td>results</td></tr>';
                for (var version in versions) if (versions.hasOwnProperty(version)) {
                    var models = versions[version];
                    for (var model in models) if (models.hasOwnProperty(model)) {
                        var results = models[model];
                        var pass = (results.tests - results.num_fails);
                        var percent = ((pass / results.tests)*100).toFixed(2);
                        results_table += '<tr><td>' + version + '</td><td>' + model + '</td><td>pass: ' + pass + ', fail: ' + results.num_fails + ', %: ' + percent + '</td></tr>';
                    }
                }
                results_table += '</table>';
                platform_table += results_table;
            }
            platform_table += '</td></tr>';
        });
        platform_table += '<table>';
        data[platform] = platform_table;
    }
    return data;
}

function interpolate_template(tmpl, object) {
    for (var token in object) if (object.hasOwnProperty(token)) {
        tmpl = tmpl.replace(new RegExp("{" + token + "}", "g"), object[token]);
    }
    return tmpl;
}

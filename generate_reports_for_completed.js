/*jslint node: true */
"use strict";

const db = require('ocore/db.js');
const fs = require('fs');
const util = require('util');
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const reports = require('./modules/reports.js');
const notifications = require('./modules/notifications.js');

/*
*	Erase the current index.html with the template then regenerate all reports
*/

async function startGeneration() {
	let content;
	try {
		content = await readFile('reports/templates/index.html');
		await writeFile("reports/index.html", content);
	}
	catch (error) {
		notifications.notifyAdmin("Couldn't open/write reports/templates/index.html", error);
		return console.error(error);
	}
	try {
		content = await readFile('reports/templates/rss.xml');
		await writeFile("reports/rss.xml", content);
	}
	catch (error) {
		notifications.notifyAdmin("Couldn't open/write reports/templates/rss.xml", error);
		return console.error(error);
	}
	db.query("SELECT id,creation_date FROM distributions WHERE is_completed=1 ORDER BY id ASC", function(rows) {
		generateReports(rows);
	});
}

startGeneration();

async function generateReports(rows) {
	if (!rows[0]) {
		console.log("\nHTML files generated");
		process.exit();
	}
	await reports.add(rows[0].id, rows[0].creation_date);
	rows.shift();
	generateReports(rows);
}
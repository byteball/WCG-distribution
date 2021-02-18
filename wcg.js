/*jslint node: true */
"use strict";
const async = require('async');
const i18nModule = require("i18n");
const constants = require('ocore/constants.js');
const eventBus = require('ocore/event_bus.js');
const headlessWallet = require('headless-obyte');
const desktopApp = require('ocore/desktop_app.js');
const notifications = require('./modules/notifications.js');
const randomCryptoString = require('./modules/random-crypto-string');
const conf = require('ocore/conf.js');
const db = require('ocore/db.js');
const validationUtils = require("ocore/validation_utils.js");
const conversion = require('./modules/conversion');
const wcg_api = require('./modules/wcg_api.js');
const mutex = require('ocore/mutex.js');
const reports = require('./modules/reports.js');

var my_address;

var assocPeers = [];
var honorificAsset;

var arrLanguages = [];
if (conf.isMultiLingual) {
	for (var index in conf.languagesAvailable) {
		arrLanguages.push(conf.languagesAvailable[index].file);
	}
}

i18nModule.configure({
	locales: arrLanguages,
	directory: __dirname + '/locales'
});

checkAllTranslations(); //crash now if badly formatted translation encountered

function checkAllTranslations() {
	var i18n = {};
	i18nModule.init(i18n);
	for (var lang in i18nModule.getCatalog()) {
		console.log("\n------- Checking " + lang + "-------");
		i18nModule.setLocale(i18n, lang);
		for (var string in i18nModule.getCatalog()[lang]) {
			//console.log(i18n.__(string)); // outputting some language string here hides the passphrase input
		}
	}
}



function processTxt(from_address, text) {
	var device = require('ocore/device.js');
	text = text.trim();

	if (!assocPeers[from_address]) {
		assocPeers[from_address] = {
			step: "home"
		};
	}

	db.query(
		"SELECT lang,salt,id,member_id,payout_address,account_name FROM users WHERE device_address == ? ", [from_address],
		function(user) {

			if (user[0]) {

				var i18n = {};
				i18nModule.init(i18n);

				if (user[0].lang != 'unknown') {
					i18nModule.setLocale(i18n, conf.languagesAvailable[user[0].lang].file);
				}


				/*
				 * user selected a new language
				 */
				if (text.indexOf('selectLanguage_') == 0 && conf.isMultiLingual) {

					if (text.split('_')[1] && conf.languagesAvailable[text.split('_')[1]]) {
						db.query("UPDATE users SET lang=? WHERE device_address == ? ", [text.split('_')[1], from_address]);
						i18nModule.setLocale(i18n, conf.languagesAvailable[text.split('_')[1]].file);
						device.sendMessageToDevice(from_address, 'text', "➡ " + getTxtCommandButton("Go back to language selection", "selectLanguage"));
					}

				}


				/*
				 * If unknown language then we propose to select one
				 */
				if ((user[0].lang === 'unknown' || text ==="selectLanguage") && conf.isMultiLingual) {
					device.sendMessageToDevice(from_address, 'text', getLanguagesSelection());
					return;
				}

				/*
				 * If admin authorized a distribution
				 */

				if (text.indexOf("distribute_") > -1 && headlessWallet.isControlAddress(from_address)) {
					db.query("UPDATE distributions SET is_authorized=1 WHERE id = ?", [Number(text.split("_")[1])], function() {
						processAnyAuthorizedDistribution();
						device.sendMessageToDevice(from_address, 'text', "Distribution id " + text.split("_")[1] + " authorized");
					});
					return;
				}


				/*
				 * Return home if cancel command
				 */
				if (text == "cancel") {
					assocPeers[from_address].step = "home";
				}

				/*
				 * Treat check account command
				 */
				if (text == "checkAndLinkAccount") {
					var accountName= conf.prefixForName + user[0].salt + user[0].id;
					wcg_api.query(accountName, {
						ifNoResponse: function() {
							device.sendMessageToDevice(from_address, 'text', i18n.__("seemsUnresponsive") + "\n" + getTxtCommandButton(i18n.__("checkAccountButton"), "checkAndLinkAccount"));
						},
						ifFailed: function() {
							device.sendMessageToDevice(from_address, 'text', i18n.__("accountCheckFailed", {
								accountName: accountName
							}) + "\n➡ " + getTxtCommandButton(i18n.__("checkAccountButton"), "checkAndLinkAccount"));
						},
						ifError: function() {
							device.sendMessageToDevice(from_address, 'text', i18n.__("errorOccurred") + "\n" + getTxtCommandButton(i18n.__("checkAccountButton"), "checkAndLinkAccount"));
						},
						ifSuccess: function(statsObject) {

							db.takeConnectionFromPool(function(conn) {
								var arrQueries = [];
								var initialRewardToUser = 0;
								conn.addQuery(arrQueries, "BEGIN");
								conf.arrayInitialRewards.forEach(function(initialReward) {
									if (statsObject.points > initialReward.threshold && initialRewardToUser < initialReward.rewardInDollars) // we find the higher reward for this user score
										initialRewardToUser = initialReward.rewardInDollars;
								});
								if (statsObject.points > 0)
									conn.addQuery(
										arrQueries,
										"INSERT OR IGNORE INTO initial_rewards (bytes_reward,assets_reward,member_id,device_address) \n\
										VALUES ( \n\
											CASE \n\
											WHEN (SELECT count(*) FROM wcg_scores WHERE member_id = ?) = 0 THEN ? \n\
											ELSE 0 \n\
											END,\n\
											CASE \n\
											WHEN (SELECT count(*) FROM wcg_scores WHERE member_id = ?) = 0 THEN ? \n\
											ELSE 0 \n\
											END, \n\
											?,? \n\
										)",
										[statsObject.memberId, Math.floor(initialRewardToUser * conversion.getPriceInBytes(1)),
										statsObject.memberId, statsObject.points,
										statsObject.memberId, from_address]
									); //If member_id already known, we set 0 as initial reward
								conn.addQuery(arrQueries, "UPDATE users SET member_id=null WHERE member_id=?", [statsObject.memberId]); //we remove linking for any users already using this account ID
								conn.addQuery(arrQueries, "UPDATE users SET member_id=?,account_name=? WHERE device_address=?", [statsObject.memberId, accountName, from_address]);
								conn.addQuery(arrQueries, "INSERT OR IGNORE INTO wcg_scores  (distribution_id, device_address, member_id, score, diff_from_previous) VALUES ((SELECT max(id) FROM distributions WHERE is_completed=1),?,?,?,0)", [from_address, statsObject.memberId, statsObject.points]);
								conn.addQuery(arrQueries, "INSERT OR IGNORE INTO wcg_meta_infos  (distribution_id, device_address, member_id, nb_devices, run_time_per_day, run_time_per_result, points_per_hour_runtime, points_per_day, points_per_result) VALUES ((SELECT max(id) FROM distributions WHERE is_completed=1),?,?,?,?,?,?,?,?)", [from_address, statsObject.memberId, statsObject.numDevices, statsObject.runTimePerDay, statsObject.runTimePerResult, statsObject.pointsPerHourRunTime, statsObject.pointsPerDay, statsObject.pointsPerResult]);
								conn.addQuery(arrQueries, "COMMIT");
								async.series(arrQueries, function() {
									conn.release();
									assocPeers[from_address].step = "insertAddress";
									device.sendMessageToDevice(from_address, 'text', i18n.__("accountLinked") + "\n" + (statsObject.isUserInTeam ? i18n.__("userInTeam", {
												bonus: conf.bonusInPercentForUserInTeam
											}) : i18n.__("userNotInTeam", {
												bonus: conf.bonusInPercentForUserInTeam,
												teamId: conf.teamId
											})) + 
											"\n" + i18n.__("insertAddress"));
								});
							});

						}
					});
					return;
				}

				/*
				 * If no WCG account registered or user requested to register a new one
				 */
				if (!user[0].member_id || text == "linkAccount") {
					var returnedTxt = i18n.__("newAccount", {
						username: conf.prefixForName + user[0].salt + user[0].id,
						teamId: conf.teamId
					});
					returnedTxt += "\n\n" + i18n.__("usernameCanBeChanged");
					returnedTxt += "\n➡ " + getTxtCommandButton(i18n.__("checkAccountButton"), "checkAndLinkAccount");
					device.sendMessageToDevice(from_address, 'text', returnedTxt);
					return;
				}


				/*
				 * If  insert address step
				 */

				if (assocPeers[from_address].step == "insertAddress") {
					if (validationUtils.isValidAddress(text)) {
						db.takeConnectionFromPool(function(conn) {
						var arrQueries = [];
						conn.addQuery(arrQueries, "BEGIN");
						conn.addQuery(arrQueries, "UPDATE users SET payout_address=? WHERE device_address = ? ", [text, from_address]);
						conn.addQuery(arrQueries, "UPDATE initial_rewards SET payout_address=? WHERE member_id=? AND payout_address IS NULL",[text, user[0].member_id]);
						conn.addQuery(arrQueries, "COMMIT");
						async.series(arrQueries, function() {
							conn.release();
							assocPeers[from_address].step = "home";
							device.sendMessageToDevice(from_address, 'text', i18n.__("addressLinked") + " " + getSetupCompletedMessage());
							sendPendingInitialRewards();
						});
					});

					} else {
						device.sendMessageToDevice(from_address, 'text', i18n.__("notValidAddress") + "\n" + i18n.__("insertAddress"));
					}
					return;
				}


				/*
				 * If no address set for payout
				 */
				if (!user[0].payout_address || text == "changePayoutAddress") {
					assocPeers[from_address].step = "insertAddress";
					device.sendMessageToDevice(from_address, 'text', i18n.__("insertAddress"));
					return;
				}


				/*
				 * If user wants to change account name
				 */

				if (text == "changeAccountName") {
					assocPeers[from_address].step = "changeAccountName";
					device.sendMessageToDevice(from_address, 'text', i18n.__("enterNewUsername", {
						accountID: user[0].member_id
					}) + "\n➡ " + getTxtCommandButton(i18n.__("cancelButton"), "cancel"));
					return;
				}

				/*
				 * If expecting an account name
				 */

				if (assocPeers[from_address].step == "changeAccountName") {
					if (text.length > 30) {
						device.sendMessageToDevice(from_address, 'text', i18n.__("The name cannot exceed 30 characters."));

					} else {
						if (text != "retryChangeName")
							assocPeers[from_address].newName = text;

						wcg_api.query(assocPeers[from_address].newName, {
							ifNoResponse: function() {
								assocPeers[from_address].step = "home";
								device.sendMessageToDevice(from_address, 'text', i18n.__("seemsUnresponsive") + "\n➡ " + getTxtCommandButton(i18n.__("retryButton"), "retryChangeName") + "\n➡ " + getTxtCommandButton(i18n.__("anotherUsernameButton"), "changeAccountName") + "\n➡ " + getTxtCommandButton(i18n.__("cancelButton"), "cancel"));
							},
							ifFailed: function() {
									device.sendMessageToDevice(from_address, 'text', i18n.__("accountCheckFailed", {
									accountName: assocPeers[from_address].newName
								}) + "\n➡ " + getTxtCommandButton(i18n.__("retryButton"), "retryChangeName") + "\n➡ " + getTxtCommandButton(i18n.__("anotherUsernameButton"), "changeAccountName") + "\n➡ " + getTxtCommandButton(i18n.__("cancelButton"), "cancel"));

							},
							ifError: function() {
								assocPeers[from_address].step = "home";
								device.sendMessageToDevice(from_address, 'text', i18n.__("errorOccurred") + "\n" + getTxtCommandButton(i18n.__("changeUsernameButton"), "changeAccountName") + "\n" + getTxtCommandButton(i18n.__("cancelButton"), "cancel"));
							},
							ifSuccess: function(statsObject) {
								assocPeers[from_address].step = "home";
								if (user[0].member_id === statsObject.memberId) {
									db.query("UPDATE users SET account_name=? WHERE member_id=?", [assocPeers[from_address].newName, user[0].member_id], function() {
										device.sendMessageToDevice(from_address, 'text', i18n.__("usernameValidated") + "\n➡ " + getTxtCommandButton(i18n.__("okButton"), "ok"))
									});
								} else {
									assocPeers[from_address].step = "home";
									device.sendMessageToDevice(from_address, 'text', i18n.__("usernameMismatch", {
										accountID: user[0].member_id
									}) + "\n➡ " + getTxtCommandButton(i18n.__("changeUsernameButton"), "changeAccountName") + "\n➡ " + getTxtCommandButton(i18n.__("cancelButton"), "cancel"));

								}
							}
						});
						return;

					}
				}

				/*
				 * Welcome message for a complete set-up
				 */

				device.sendMessageToDevice(from_address, 'text', getSetupCompletedMessage());

				function getSetupCompletedMessage() {
					return i18n.__("setupComplete", {
							accountName: user[0].account_name,
							accountID: user[0].member_id
						}) +
						"\n" + i18n.__("visitWiki") + "\n"
						 + "\n➡ " + getTxtCommandButton(i18n.__("changeLinkedButton"), "linkAccount") + "\n➡ " + getTxtCommandButton(i18n.__("changePayoutButton"), "changePayoutAddress") + "\n➡ " + getTxtCommandButton(i18n.__("changeUsernameButton"), "changeAccountName");
				}
			}
		});
}

function crawlForAnyPendingDistribution() {


	db.query("SELECT id from distributions WHERE is_crawled = 0 ORDER BY id DESC LIMIT 1", function(distributions) {
		if (distributions.length == 1) {
			db.query("SELECT account_name,device_address,payout_address,member_id,lang FROM users WHERE member_id NOT IN (SELECT member_id FROM wcg_scores WHERE distribution_id = ?) AND account_name NOT NULL AND member_id NOT NULL AND has_crawl_error = 0", [distributions[0].id], function(users) {

				if (users.length == 0) {

					db.takeConnectionFromPool(function(conn) {
						var arrQueries = [];
						conn.addQuery(arrQueries, "BEGIN");
						conn.addQuery(arrQueries, "UPDATE distributions SET is_crawled=1 WHERE id = ?", [distributions[0].id]);
						conn.addQuery(arrQueries, "UPDATE users SET has_crawl_error=0");
						conn.addQuery(arrQueries, "COMMIT");
						async.series(arrQueries, function() {
							conn.release();
							sendReportToAdmin();
							// auto authorize
							db.query("UPDATE distributions SET is_authorized=1 WHERE id = ?", [distributions[0].id], () => {
								processAnyAuthorizedDistribution();
							});
						});
					});

				} else {
					crawlScores(users, function() {
						crawlForAnyPendingDistribution();
					});
				}

			});
		}
	});

}

function crawlScores(users, handle) {
	if (users.length == 0) {
		return handle();
	}

	var i18n = {};
	i18nModule.init(i18n);

	wcg_api.query(users[0].account_name, {

		ifNoResponse: function() {
			console.log("Error, World Community Grid seems unresponsive");
			setTimeout(function() {
				crawlScores(users, function() {
					return handle();
				});
			}, 60 * 1000);
		},
		ifFailed: function() {
			if (users[0].lang != 'unknown' && conf.isMultiLingual) {
				i18nModule.setLocale(i18n, conf.languagesAvailable[users[0].lang].file);
			}
			var device = require('ocore/device.js');
			device.sendMessageToDevice(users[0].device_address, 'text', i18n.__("scoreFetchingFailed", {
				accountName: users[0].account_name
			}) + "\n➡ " + getTxtCommandButton(i18n.__("okButton"), "ok"));
			db.query("UPDATE users SET has_crawl_error=1 WHERE device_address=?", [users[0].device_address], function() {
				users.shift();
				crawlScores(users, function() {
					return handle();
				});
			});
		},
		ifError: function() {
			setTimeout(function() {
				crawlScores(users, function() {
					return handle();
				});
			}, 60 * 1000);
		},
		ifSuccess: function(statsObject) {
			if (users[0].member_id === statsObject.memberId) {
				var coeffForUserInTeam = 1;
				if (statsObject.isUserInTeam)
					coeffForUserInTeam = 1 + conf.bonusInPercentForUserInTeam/100;
				
				var maxDevices = conf.maxDevices;
				if (statsObject.accountAge > 1)
					maxDevices *= statsObject.accountAge;
				
				var coeffForDevicesOverLimit = 1;
				if (statsObject.numDevices > maxDevices)
					coeffForDevicesOverLimit = maxDevices / statsObject.numDevices;
				
				db.takeConnectionFromPool(function(conn) {
					var arrQueries = [];
					conn.addQuery(arrQueries, "BEGIN");
					conn.addQuery(arrQueries, "INSERT OR IGNORE INTO wcg_scores (distribution_id, device_address, payout_address, member_id, score, diff_from_previous) VALUES ((SELECT max(id) FROM distributions WHERE is_crawled=0),?,?,?,?, ? - (SELECT score FROM wcg_scores WHERE distribution_id = (SELECT max( distribution_id) FROM wcg_scores WHERE member_id =?) AND member_id =?))", [users[0].device_address, users[0].payout_address, statsObject.memberId, statsObject.points, statsObject.points, statsObject.memberId, statsObject.memberId]);
					conn.addQuery(arrQueries, "INSERT OR IGNORE INTO wcg_meta_infos (distribution_id, device_address, member_id, nb_devices, run_time_per_day, run_time_per_result, points_per_hour_runtime, points_per_day, points_per_result) VALUES ((SELECT max(id) FROM distributions WHERE is_crawled=0),?,?,?,?,?,?,?,?)", [users[0].device_address, statsObject.memberId, statsObject.numDevices, statsObject.runTimePerDay, statsObject.runTimePerResult, statsObject.pointsPerHourRunTime, statsObject.pointsPerDay, statsObject.pointsPerResult]);
					conn.addQuery(arrQueries, "UPDATE wcg_scores SET bytes_reward= CAST(diff_from_previous * ? AS INT) WHERE distribution_id =(SELECT max( distribution_id) FROM wcg_scores WHERE member_id =?) AND member_id =?", [conversion.getPriceInBytes(1) * conf.WCGpointToDollar * coeffForUserInTeam * coeffForDevicesOverLimit, statsObject.memberId, statsObject.memberId]);
					conn.addQuery(arrQueries, "COMMIT");
					async.series(arrQueries, function() {
						conn.release();
						users.shift();
						crawlScores(users, function() {
							return handle();
						});
					});
				});

			} else {
				if (users[0].lang != 'unknown' && conf.isMultiLingual) {
					i18nModule.setLocale(i18n, conf.languagesAvailable[users[0].lang].file);
				}
				var device = require('ocore/device.js');
				device.sendMessageToDevice(users[0].device_address, 'text', i18n.__("fixUsernameMismatch", {
					accountName: users[0].account_name,
					accountID: users[0].member_id
				}) + "\n➡ " + getTxtCommandButton(i18n.__("okButton"), "ok"));
				db.query("UPDATE users SET has_crawl_error=1 WHERE device_address=?", [users[0].device_address], function() {
					users.shift();
					crawlScores(users, function() {
						return handle();
					});
				});
			}

		}

	});
}


function sendPendingInitialRewards() {

	mutex.lock(['sendPendingInitialRewards'], function(unlock) {
		db.query("SELECT DISTINCT member_id, bytes_reward,payout_address, device_address,assets_reward\n\
		FROM initial_rewards \n\
		LEFT JOIN outputs AS outputs_bytes\n\
			ON initial_rewards.payout_address=outputs_bytes.address \n\
			AND outputs_bytes.asset IS NULL \n\
			AND (SELECT address FROM unit_authors WHERE unit_authors.unit=outputs_bytes.unit)=? \n\
			AND CAST(bytes_reward as INT)=outputs_bytes.amount\n\
		LEFT JOIN outputs AS outputs_assets\n\
			ON initial_rewards.payout_address=outputs_assets.address \n\
			AND outputs_assets.asset = ? \n\
			AND (SELECT address FROM unit_authors WHERE unit_authors.unit=outputs_assets.unit)=? \n\
			AND CAST(assets_reward as INT)=outputs_assets.amount\n\
		WHERE outputs_assets.address IS NULL AND outputs_bytes.address IS NULL \n\
			AND (bytes_reward>0 OR assets_reward>0)\n\
			AND payout_address IS NOT NULL  \n\
			AND payment_unit IS NULL \n\
		ORDER BY bytes_reward \n\
		LIMIT ?", [my_address, honorificAsset, my_address, constants.MAX_OUTPUTS_PER_PAYMENT_MESSAGE - 1],
			function(rows) {
				if (rows.length === 0)
					return unlock();
				var arrOutputsBytes = [];
				var arrOutputsAssets = [];
				var arrMemberIDs = [];
				rows.forEach(function(row) {
					if (row.bytes_reward>0){
						arrOutputsBytes.push({
							amount: row.bytes_reward,
							address: row.payout_address
						});
					}
					arrOutputsAssets.push({
						amount: row.assets_reward,
						address: row.payout_address
					});
					arrMemberIDs.push(row.member_id);
				});
				var opts = {
					asset: honorificAsset,
					base_outputs: arrOutputsBytes,
					asset_outputs: arrOutputsAssets,
					change_address: my_address,
					recipient_device_addresses: rows.map(row => row.device_address)
				};
				headlessWallet.sendMultiPayment(opts, function(err, unit) {
					if (err) {
						notifications.notifyAdmin("a payment failed", err);
						setTimeout(sendPendingInitialRewards, 300 * 1000);
						unlock();
					} else {
						var device = require('ocore/device.js');
						var i18n = {};
						i18nModule.init(i18n);
						db.query("UPDATE initial_rewards SET payment_unit=? WHERE member_id IN (?)", [unit, arrMemberIDs], function() {
							db.query("SELECT  initial_rewards.device_address AS device_address,bytes_reward,assets_reward,lang FROM initial_rewards \n\
									 LEFT JOIN users \n\
									 	ON users.device_address=initial_rewards.device_address \n\
									 WHERE initial_rewards.member_id IN (?)", [arrMemberIDs], function(rows) {
								rows.forEach(function(row) {
									if (row.lang != 'unknown' && conf.isMultiLingual) {
										i18nModule.setLocale(i18n, conf.languagesAvailable[row.lang].file);
									}
									console.log("Sent payout notification in language: " + row.lang);
									device.sendMessageToDevice(row.device_address, 'text', i18n.__("payoutForPreviousWork", {
										amountByte: (row.bytes_reward / 1e9).toLocaleString([], {maximumFractionDigits:9}),
										amountAsset:row.assets_reward,labelAsset:conf.labelAsset
									}));
								});
								unlock();
							});

						});
					}
				});

			});
	});

}


function initiateNewDistributionIfNeeded() {

	db.query("SELECT id, CASE \n\
	WHEN is_completed = 0 AND (SELECT COUNT(*) FROM wcg_scores WHERE distribution_id=id) > 0 THEN 0	\n\
	WHEN creation_date < datetime('now', '-" + conf.daysBetweenDistributions + " days') THEN 1	\n\
	END isNewDistributionNeeded	\n\
	FROM distributions ORDER BY id DESC LIMIT 1", function(rows) {
		if (rows[0] && rows[0].isNewDistributionNeeded) {
			db.query("INSERT INTO distributions (is_crawled,is_authorized,is_completed) VALUES (0,0,0)", function() {
				crawlForAnyPendingDistribution();
			});
		}
	});

}

function processAnyAuthorizedDistribution() {
	var device = require('ocore/device.js');
	db.query("SELECT id,creation_date FROM distributions WHERE is_authorized=1 AND is_completed=0", function(authorizedDistributions) {
		if (authorizedDistributions.length === 1) {

			var walletGeneral = require('ocore/wallet_general.js');
			var i18n = {};
			i18nModule.init(i18n);
			createDistributionOutputs(authorizedDistributions[0].id, authorizedDistributions[0].creation_date, function(arrOutputsBytes, arrOutputsAssets,arrMemberIDs) {
				if (!arrOutputsBytes) { // done
					db.query("UPDATE distributions SET is_completed=1 WHERE id=?", [authorizedDistributions[0].id], function() {});
					return verifyDistribution(authorizedDistributions[0].id, authorizedDistributions[0].creation_date);
				}
				var opts = {
					asset: honorificAsset,
					base_outputs: arrOutputsBytes,
					asset_outputs: arrOutputsAssets,
					change_address: my_address
				};
				console.log(opts);
				headlessWallet.sendMultiPayment(opts, function(err, unit) {
					if (err) {
						notifications.notifyAdmin("a payment failed", err);
						setTimeout(processAnyAuthorizedDistribution, 300 * 1000);

					} else {

						db.query("UPDATE wcg_scores SET payment_unit=? WHERE member_id IN (?) AND distribution_id=?", [unit, arrMemberIDs, authorizedDistributions[0].id], function() {
							db.query("SELECT  wcg_scores.device_address AS device_address,bytes_reward,diff_from_previous,lang FROM wcg_scores \n\
									 LEFT JOIN users \n\
									 	ON users.device_address=wcg_scores.device_address \n\
									 WHERE wcg_scores.member_id IN (?) AND distribution_id=?", [arrMemberIDs, authorizedDistributions[0].id], function(rows) {
								rows.forEach(function(row){

									if (row.lang != 'unknown' && conf.isMultiLingual) {
										i18nModule.setLocale(i18n, conf.languagesAvailable[row.lang].file);
									}
									console.log("Sent payout notification in language: "+ row.lang);
									device.sendMessageToDevice(row.device_address, 'text', i18n.__("payoutForCurrentWork",{amountByte:(row.bytes_reward/1e9).toLocaleString([], {maximumFractionDigits:9}), amountAsset:row.diff_from_previous,labelAsset:conf.labelAsset}));
									walletGeneral.sendPaymentNotification(row.device_address, unit);
								});
							});
							setTimeout(processAnyAuthorizedDistribution, 30 * 1000);

						});
					}
				});
			});
		}
	});
}


function createDistributionOutputs(distributionID, distributionDate, handleOutputs) {
	db.query(
		"SELECT bytes_reward,payout_address, device_address,diff_from_previous,member_id \n\
		FROM wcg_scores \n\
		LEFT JOIN outputs \n\
			ON wcg_scores.payout_address=outputs.address \n\
			AND asset IS NULL \n\
			AND (SELECT address FROM unit_authors WHERE unit_authors.unit=outputs.unit)=? \n\
			AND (SELECT creation_date FROM units WHERE units.unit=outputs.unit)>? \n\
			AND CAST(bytes_reward as INT)=outputs.amount\n\
		WHERE outputs.address IS NULL \n\
			AND distribution_id=?  \n\
			AND bytes_reward>0 \n\
			AND diff_from_previous>0  \n\
			AND payout_address IS NOT NULL  \n\
			AND payment_unit IS NULL \n\
		ORDER BY bytes_reward \n\
		LIMIT ?", [my_address, distributionDate, distributionID, constants.MAX_OUTPUTS_PER_PAYMENT_MESSAGE-1],
		function(rows) {
			if (rows.length === 0)
				return handleOutputs();
			var arrOutputsBytes = [];
			var arrOutputsAssets = [];
			var arrMemberIDs = [];
			rows.forEach(function(row) {
				arrOutputsBytes.push({
					amount: row.bytes_reward,
					address: row.payout_address
				});
				arrOutputsAssets.push({
					amount: row.diff_from_previous,
					address: row.payout_address
				});
				arrMemberIDs.push(row.member_id);

			});
			handleOutputs(arrOutputsBytes, arrOutputsAssets,arrMemberIDs);
		}
	);
}

function verifyDistribution(distributionID, distributionDate) {
	db.query(
		"SELECT SUM(outputs.amount) AS total FROM outputs JOIN unit_authors USING(unit) JOIN units USING(unit) \n\
		WHERE unit_authors.address=? AND outputs.address!=? AND asset IS NULL AND creation_date>?", [my_address, my_address, distributionDate],
		function(rows) {
			var total = rows[0].total;
			db.query("SELECT SUM(bytes_reward) AS total_bytes FROM wcg_scores WHERE distribution_id=?", [distributionID], function(rows) {
				var expected_total = Math.round(rows[0].total_bytes);
				var overpaid = total - expected_total;
				console.log("---- total paid: " + total + ", overpaid: " + overpaid);
				console.error("----- total paid: " + total + ", overpaid: " + overpaid);
				notifications.notifyAdmin("Distribution id " + distributionID + " done", distributionDate + "\n ---- total paid: " + total + ", overpaid: " + overpaid);
				reports.add(distributionID,distributionDate);
			});
		}
	);
}

function sendReportToAdmin() {

	db.query("SELECT wcg_scores.distribution_id AS distribution_id,wcg_scores.member_id AS member_id,bytes_reward, diff_from_previous,account_name FROM wcg_scores \n\
			INNER JOIN wcg_meta_infos \n\
				ON wcg_scores.member_id = wcg_meta_infos.member_id \n\
				AND wcg_scores.distribution_id = wcg_meta_infos.distribution_id \n\
			LEFT JOIN users \n\
				ON users.device_address = wcg_scores.device_address \n\
			WHERE wcg_scores.distribution_id = (SELECT max(id) FROM distributions WHERE is_crawled=1 AND is_completed=0) ORDER BY bytes_reward DESC", function(rows) {

		if (rows.length === 0)
			return;
		var totalAssets = 0;
		var totalBytes = 0;
		var totalUsers = 0;
		rows.forEach(function(row) {
			totalAssets+= row.diff_from_previous;
			totalBytes+= row.bytes_reward;
			if(row.diff_from_previous<0){
				return notifications.notifyAdmin("Error for distribution id " + rows[0].distribution_id, "Member ID " + row.member_id + "  has negative reward");
			}
			if(row.diff_from_previous>0){
				totalUsers++;
			}
		});
		var bodyEmail = "Distribution id " + rows[0].distribution_id + " ready, paste distribute_" + rows[0].distribution_id + " to start it\n";
		bodyEmail += "Total bytes to be distributed: " + Math.round(totalBytes) + " to " + totalUsers + " users\n";
		bodyEmail += "Total assets to be distributed: " + Math.round(totalAssets) + " to " + totalUsers + " users\n";
		bodyEmail += "User ID	Bytes reward	Asset reward	Account name\n";

		rows.forEach(function(row) {
			if(row.diff_from_previous>0){
				bodyEmail += row.member_id + "	 " + Math.round(row.bytes_reward) + "	 " + Math.round(row.diff_from_previous)+ "	" + row.account_name + "\n";
			}
		});
		return notifications.notifyAdmin("Distribution id " + rows[0].distribution_id + " ready", bodyEmail)
	});

}


function getLanguagesSelection() {

	var returnedTxt = "Please select your language: ";
	for (var index in conf.languagesAvailable) {
		returnedTxt += "\n➡ " + getTxtCommandButton(conf.languagesAvailable[index].name, "selectLanguage_" + index);
	}

	return returnedTxt;
}


function getTxtCommandButton(label, command) {
	var text = "";
	var _command = command ? command : label;
	text += "[" + label + "]" + "(command:" + _command + ")";
	return text;
}


eventBus.on('text', function(from_address, text) {
	processTxt(from_address, text);
});


eventBus.on('paired', function(from_address) {
	db.query("INSERT OR IGNORE INTO users (device_address,salt) VALUES (?,?)", [from_address, randomCryptoString.generateByLengthSync(4)], function() {
		processTxt(from_address, '');
	});
});



eventBus.on('headless_wallet_ready', function() {
	if (!conf.admin_email || !conf.from_email) {
		console.log("please specify admin_email and from_email in your " + desktopApp.getAppDataDir() + "/conf.json");
		process.exit(1);
	}

	if (!conf.bSingleAddress) {
		console.log("config must be single address wallet");
		process.exit(1);
	}

	headlessWallet.readSingleAddress(function(address) {
		my_address = address;

		db.query("SELECT unit FROM honorific_asset ", function(honorific_asset) {
			if (honorific_asset.length > 1) {
				console.log("honorific_asset should contain only one row");
				process.exit(1);
			}

			if (honorific_asset.length === 0) {
				console.log("No honorific asset set yet, please fund " + my_address + " then execute create_honorific_asset.js");
				setTimeout(function() { //let enough time for the node to initialize a first time
					process.exit(1)
				}, 5000);
			}
			else {
				honorificAsset = honorific_asset[0].unit;
				console.log("honorific asset: " + honorificAsset);
			}

			setTimeout(function() {
				crawlForAnyPendingDistribution()
				processAnyAuthorizedDistribution();
				initiateNewDistributionIfNeeded();
				sendPendingInitialRewards();
				setInterval(initiateNewDistributionIfNeeded, 5 * 60 * 1000);
			}, 5000);
		});

	});

});
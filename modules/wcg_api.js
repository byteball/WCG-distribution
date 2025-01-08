/*jslint node: true */
"use strict";
const request = require('request');
const xml2js = require('xml2js');
const notifications = require('./notifications.js');
const conf = require('ocore/conf.js');
const moment = require ('moment');

let last_notification_ts = 0;

function query(accountName, callbacks) {

	request({
		url: "https://www.worldcommunitygrid.org/stat/viewMemberInfo.do?userName=" + accountName + "&xml=true"
	}, function(error, response, body) {
		if (error || response.statusCode !== 200) {
			return callbacks.ifNoResponse();
		} else {
			xml2js.parseString(body, function(errParsing, rawObject) {
				if (errParsing) {
				return callbacks.ifFailed();

				} else {
					checkAndReformatRawObject(rawObject, function(errReformating, statsObject) {
						if (errReformating) {
							console.log("WCG returned a badly formatted XML " + body);
							if (Date.now() - last_notification_ts > 3_600_000) {
								notifications.notifyAdmin(errReformating, body);
								last_notification_ts = Date.now();
							}
							return callbacks.ifError();
						} else {
							return callbacks.ifSuccess(statsObject);
						}

					});

				}

			});

		}
	})
}



function checkAndReformatRawObject(rawObject, handle) {

	if (rawObject.MemberStats && rawObject.MemberStats.MemberStat && rawObject.MemberStats.MemberStat[0] &&
		rawObject.MemberStats.MemberStat[0].Name && rawObject.MemberStats.MemberStat[0].Name[0] &&
		rawObject.MemberStats.MemberStat[0].MemberId && rawObject.MemberStats.MemberStat[0].MemberId[0]) {

		var formatedObject = {
			name: rawObject.MemberStats.MemberStat[0].Name[0],
			memberId: Number(rawObject.MemberStats.MemberStat[0].MemberId[0]),
			numDevices: 0,
			points: 0,
			runTimePerDay: 0,
			runTimePerResult: 0,
			pointsPerHourRunTime: 0,
			pointsPerDay: 0,
			pointsPerResult: 0,
			accountAge:0
		}

		formatedObject.isUserInTeam = ((rawObject.MemberStats.MemberStat[0].TeamId && rawObject.MemberStats.MemberStat[0].TeamId[0] && rawObject.MemberStats.MemberStat[0].TeamId[0] === conf.teamId) ?  true : false);

		if (rawObject.MemberStats.MemberStat[0].RegisterDate && rawObject.MemberStats.MemberStat[0].RegisterDate[0] &&
			rawObject.MemberStats.MemberStat[0].NumDevices && rawObject.MemberStats.MemberStat[0].NumDevices[0] &&
			rawObject.MemberStats.MemberStat[0].StatisticsTotals && rawObject.MemberStats.MemberStat[0].StatisticsTotals[0] &&
			rawObject.MemberStats.MemberStat[0].StatisticsTotals[0].Points && rawObject.MemberStats.MemberStat[0].StatisticsTotals[0].Points[0] &&
			rawObject.MemberStats.MemberStat[0].StatisticsAverages && rawObject.MemberStats.MemberStat[0].StatisticsAverages[0] &&
			rawObject.MemberStats.MemberStat[0].StatisticsAverages[0].RunTimePerDay && rawObject.MemberStats.MemberStat[0].StatisticsAverages[0].RunTimePerDay[0] &&
			rawObject.MemberStats.MemberStat[0].StatisticsAverages[0].RunTimePerResult && rawObject.MemberStats.MemberStat[0].StatisticsAverages[0].RunTimePerResult[0] &&
			rawObject.MemberStats.MemberStat[0].StatisticsAverages[0].PointsPerHourRunTime && rawObject.MemberStats.MemberStat[0].StatisticsAverages[0].PointsPerHourRunTime[0] &&
			rawObject.MemberStats.MemberStat[0].StatisticsAverages[0].PointsPerDay && rawObject.MemberStats.MemberStat[0].StatisticsAverages[0].PointsPerDay[0] &&
			rawObject.MemberStats.MemberStat[0].StatisticsAverages[0].PointsPerResult && rawObject.MemberStats.MemberStat[0].StatisticsAverages[0].PointsPerResult[0]) {

			formatedObject.accountAge = moment().diff(moment(rawObject.MemberStats.MemberStat[0].RegisterDate[0]), 'years');
			formatedObject.numDevices = Number(rawObject.MemberStats.MemberStat[0].NumDevices[0]);
			formatedObject.points = Number(rawObject.MemberStats.MemberStat[0].StatisticsTotals[0].Points[0]);
			formatedObject.runTimePerDay = Number(rawObject.MemberStats.MemberStat[0].StatisticsAverages[0].RunTimePerDay[0]);
			formatedObject.runTimePerResult = Number(rawObject.MemberStats.MemberStat[0].StatisticsAverages[0].RunTimePerResult[0]);
			formatedObject.pointsPerHourRunTime = Number(rawObject.MemberStats.MemberStat[0].StatisticsAverages[0].PointsPerHourRunTime[0]);
			formatedObject.pointsPerDay = Number(rawObject.MemberStats.MemberStat[0].StatisticsAverages[0].PointsPerDay[0]);
			formatedObject.pointsPerResult = Number(rawObject.MemberStats.MemberStat[0].StatisticsAverages[0].PointsPerResult[0]);
		}


	} else {
		return handle("There was a problem with XML returned by WCG");
	}

	return handle(null, formatedObject);

}

exports.query = query;
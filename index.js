const path = require('path');
const moment = require('moment');
const child_process = require('child_process');
const fs = require('fs-extra')
const fastXmlParser = require('fast-xml-parser');
const Mbox = require('node-mbox');
const simpleParser = require('mailparser').simpleParser;
const Entities = require('html-entities').AllHtmlEntities;


function getFiles (srcpath) {
  return fs.readdirSync(srcpath)
    .filter(file => fs.statSync(path.join(srcpath, file)).isFile())
}

function createRecord(source, type, from, to, timestamp, value) {
    return {
        source: source,
        type: type,
        from: from,
        to: to,
        timestamp: Math.round(timestamp),
        value: value
    };
}

function isFilteredTimestamp(timestamp) {
    var retval = false;
    // look through the Settings.exclude
    for(var i = 0; i < Settings.exclude.length; i++) {
        if(Array.isArray(Settings.exclude[i])) {
            if(timestamp >= Settings.exclude[i][0] && timestamp <= Settings.exclude[i][1]) {
                retval = true;
            }
        } else {
            if(timestamp == Settings.exclude[i]) {
                retval = true;
            }
        }
    }
    return retval;
}

let records = [];

// read in the settings file
var SettingsFile = path.join(__dirname,'settings.json');

var Settings = { 
    exclude: [], 
    mbox: {
        searchNameFrom: "",
        searchNameTo: ""
    },
    hangouts: {
        from: "",
        to: "",
        searchName: ""
    },
    sms: {
        phoneName: ""
    },
    filter: []
};

if (fs.existsSync(SettingsFile)) {
    Settings = JSON.parse(fs.readFileSync(SettingsFile));
}

processHangouts(records, () => {
    processSMS(records, () => {
        processEmails(records, () => {
            // output the values
            // got all the values
            console.log("Found: " + records.length + " records");

            // sort by timestamp
            records.sort(function(a, b){return a.timestamp - b.timestamp});

            var htmlOutput = "<html><head><meta charset='UTF-8'><style>";

            htmlOutput += fs.readFileSync("style.css");
            
            htmlOutput += "</style></head><body><table>\n"

            const entities = new Entities();

            // create a starting timestamp, and then iterate by days
            let dayIndex = moment("2015-01-01", "YYYY-MM-DD");

            // get all the messages from this day

            while(records.length > 0) {

                let daysRecords = [];

                // take the first one
                let record = records[0];

                while(record.timestamp < dayIndex.valueOf()) {
                    // remove it
                    records.shift();
                    
                    if(!filterRecord(record)) 
                    {
                        if(record.value.toString().trim() != "" && !isFilteredTimestamp(record.timestamp))
                        {
                            daysRecords.push( record );
                        }
                    }

                    // and get the next
                    if(records.length > 0) {
                        record = records[0];
                    } else {
                        break;
                    }
                }

                if(daysRecords.length > 0) {
                    // then we want to indicate the number of days here
                    console.log(moment(dayIndex).format("YYYY-MM-DD") + ": " + daysRecords.length + " messages");

                    let videoCalls = 0;
                    let emails = 0;
                    let texts = 0;
                    let allText = "";

                    for(let i = 0; i < daysRecords.length; i++) {
                        if(daysRecords[i].type == "Text") {
                            texts++;
                        } else if(daysRecords[i].type == "Video Call") {
                            videoCalls++;
                        } else if(daysRecords[i].type == "Email") {
                            emails++;
                        }
                        if(allText != "") {
                            allText += " ■ ";
                        }
                        allText += daysRecords[i].value.toString().substr(0, 200);
                    }

                    let types = "";
                    if(videoCalls > 0) {
                        types += videoCalls + " Video Call" + (videoCalls > 1 ? "s" : "");
                    }
                    if(emails > 0) {
                        if(types != "") {
                            types += ", ";
                        }
                        types += emails + " Email" + (emails > 1 ? "s" : "");
                    }
                    if(texts > 0) {
                        if(types != "") {
                            types += ", ";
                        }
                        types += texts + " Text" + (texts > 1 ? "s" : "");
                    }

                    htmlOutput += "<tr>\n";

                    htmlOutput += "<td>" + moment(daysRecords[0].timestamp).format("YYYY-MM-DD HH:mm") + "</td>\n";
                    //htmlOutput += "<td>" + record.timestamp + "</td>\n";
                    htmlOutput += "<td>" + types + "</td>\n";
                    htmlOutput += "<td>" + allText + "</td>\n";

                    htmlOutput += "</tr>\n";
                }

                
                // increment the day to the next
                dayIndex = dayIndex.add(1, 'hours');
            }

            // for(let i = 0; i < records.length; i++) {

            //     let record = records[i];

            //     if(!filterRecord(record)) 
            //     {
            //         if(record.value.toString().trim() != "" && !isFilteredTimestamp(record.timestamp))
            //         {
            //             htmlOutput += "<tr>\n";

            //             htmlOutput += "<td>" + moment(record.timestamp).format("YYYY-MM-DD HH:mm") + "</td>\n";
            //             //htmlOutput += "<td>" + record.timestamp + "</td>\n";
            //             htmlOutput += "<td>" + record.source + "</td>\n";
            //             htmlOutput += "<td>" + record.type + "</td>\n";
            //             htmlOutput += "<td>" + record.from + "</td>\n";
            //             htmlOutput += "<td>" + record.to + "</td>\n";
            //             htmlOutput += "<td>" + record.value.toString().substr(0, 200) + "</td>\n";

            //             htmlOutput += "</tr>\n";

            //             console.log((i/records.length * 100).toFixed(0) + "% done");
            //         }
            //     }
            // }

            htmlOutput += "</table></body></html>\n";

            fs.writeFile('output.html', htmlOutput, function (err) {
                if (err) throw err;
                console.log('Saved!');
            });

        });
    });
});

function filterRecord(record) {
    for(var i = 0; i < Settings.filter.length; i++) {
        if(record.value.toString().toLowerCase().includes(Settings.filter[i]))
        {
            return true;
        }
    }
    return false;
}


function processHangouts(records, onComplete) {
    var HangoutsFile = path.join(__dirname,'data','Hangouts','Hangouts.json');

    if (fs.existsSync(HangoutsFile)) {
        try
        {
            var contents = fs.readFileSync(HangoutsFile);
            var Hangouts = JSON.parse(contents);

            if(Hangouts.conversations && Hangouts.conversations.length > 0) {
                for(let i = 0; i < Hangouts.conversations.length; i++)
                {
                    let conversation = Hangouts.conversations[i];

                    let convseration_details = conversation.conversation.conversation;

                    let conversationToProcess = false;
                    let otherPersonGaiaId = "";

                    // look through the participants to see if one is the person we want
                    if(convseration_details.participant_data) {
                        for(let j = 0; j < convseration_details.participant_data.length; j++)
                        {
                            let participant = convseration_details.participant_data[j];

                            if(participant.fallback_name && participant.fallback_name.toLowerCase().includes(Settings.hangouts.searchName)) {
                                conversationToProcess = true;
                                otherPersonGaiaId = participant.id.gaia_id;
                            }
                        }
                    }

                    if(conversationToProcess) {
                        // let's process events
                        for(let j = 0; j < conversation.events.length; j++)
                        {
                            let event = conversation.events[j];

                            let to = Settings.hangouts.to;
                            let from = Settings.hangouts.from;

                            if(event.sender_id.gaia_id == otherPersonGaiaId) {
                                from = Settings.hangouts.to;
                                to = Settings.hangouts.from;
                            }

                            if(event.hangout_event) {
                                // then we have either a start or an end to a hangout
                                if(event.hangout_event.event_type == "START_HANGOUT")
                                {
                                    
                                }
                                else if(event.hangout_event.event_type == "END_HANGOUT")
                                {
                                    let duration = "0 seconds";

                                    if(event.hangout_event.hangout_duration_secs) {
                                        if(event.hangout_event.hangout_duration_secs > 60) {
                                            // minutes
                                            let minutes = Math.floor(event.hangout_event.hangout_duration_secs / 60);
                                            duration = minutes + " minute" + (minutes != 1 ? "s" : "");
                                            let remainingSeconds = event.hangout_event.hangout_duration_secs - (minutes * 60);
                                            if(remainingSeconds > 0) {
                                                duration += ", " + remainingSeconds + " second" + (remainingSeconds != 1 ? "s" : "");
                                            }
                                        } else {
                                            duration = event.hangout_event.hangout_duration_secs + " second" + (event.hangout_event.hangout_duration_secs != 1 ? "s" : "");
                                        }
                                    }

                                    records.push(createRecord("Google Hangouts", "Video Call", from, to, event.timestamp/1000, "call duration of " +  duration))
                                }
                            }
                            else if(event.chat_message) {
                                if(event.chat_message.message_content) {
                                    if(event.chat_message.message_content.segment) {
                                        for(let segIndex = 0; segIndex < event.chat_message.message_content.segment.length; segIndex++) {
                                            let segment = event.chat_message.message_content.segment[segIndex];
                                            if(segment && segment.text) {
                                                records.push(createRecord("Google Hangouts", "Text", from, to, event.timestamp/1000, segment.text));
                                            }
                                            
                                        }
                                    }
                                }
                            }

                        }
                    }
                }
            }

            // we are done
            onComplete();
        }
        catch(e) 
        {
            console.log("exception: " + e);
        }
    }
    else
    {
        console.log("No hangouts file");
    }
}


function processSMS(records, onComplete) {
    // now try and process any SMSBackupAndRestore file
    var SMSBackupAndRestoreFile = path.join(__dirname,'data','SMSBackupAndRestore','sms-20180625203534.xml');

    if (fs.existsSync(SMSBackupAndRestoreFile)) {

        let file = fs.readFileSync(SMSBackupAndRestoreFile);

        var options = {
            attributeNamePrefix : "",
            attrNodeName: "attr", //default is 'false'
            textNodeName : "#text",
            ignoreAttributes : false,
            ignoreNameSpace : false,
            allowBooleanAttributes : false,
            parseNodeValue : true,
            parseAttributeValue : true
        };

        var jsonObj = fastXmlParser.parse(file.toString(), options);

        if(jsonObj.smses && jsonObj.smses.sms) 
        {
            for(let i = 0; i < jsonObj.smses.sms.length; i++)
            {
                let sms = jsonObj.smses.sms[i];

                if(sms.attr.date && sms.attr.body)
                {
                    let to = Settings.sms.phoneName;
                    let from = sms.attr.address.toString();

                    if(sms.attr.type == 2) {
                        to = sms.attr.address.toString();
                        from = Settings.sms.phoneName;
                    }

                    records.push(createRecord("Mobile SMS", "Text", from, to, sms.attr.date, sms.attr.body))
                }
            }
        }

        onComplete();
    }
    else {
        console.log("SMSBackupAndRestore: error");
    }
}


function processEmails(records, onComplete) {
    // next parse through email messages from the MBOX file
    var GmailMboxFile = path.join(__dirname,'data','Mail','Gmail.mbox');

    const mbox = new Mbox(GmailMboxFile, { /* options */ });

    // Next, catch events generated:
    mbox.on('message', function(msg) {
        simpleParser(msg, (err, mail)=>{
            if(err) {
                console.log("simpleParser error");
            } else 
            {
                let betweenTwo = true;
                let from = "";
                let to = "";

                if(mail.from && mail.to)
                {
                    if(mail.from.value && mail.from.value.length === 1) {
                        // check that the address either has one of the two names in it
                        if( mail.from.value[0].address.toLowerCase().includes(Settings.mbox.searchNameFrom)
                            || mail.from.value[0].address.toLowerCase().includes(Settings.mbox.searchNameTo) )
                        {
                            // now let's check the to field
                            if(mail.to.value && mail.to.value.length === 1) 
                            {
                                if( mail.to.value[0].address.toLowerCase().includes(Settings.mbox.searchNameFrom)
                                    || mail.to.value[0].address.toLowerCase().includes(Settings.mbox.searchNameTo) )
                                {
                                    // we are all good
                                    from = mail.from.value[0].address;
                                    to = mail.to.value[0].address;
                                }
                                else
                                {
                                    betweenTwo = false;
                                }
                            } 
                            else 
                            {
                                betweenTwo = false;
                            }
                        } 
                        else 
                        {
                            betweenTwo = false;
                        }
                    } 
                    else 
                    {
                        betweenTwo = false;
                    }
                }
                else
                {
                    betweenTwo = false;
                }

                if(betweenTwo) 
                {
                    records.push(createRecord("Google Gmail", "Email", from, to, moment(mail.date).valueOf(), "Subject: " + mail.subject + " Body: " + mail.text))
                }
            }
        });

    });
    
    mbox.on('error', function(err) {
        console.log('GmailMboxFile: got an error', err);
    });
    
    mbox.on('end', function() {
        console.log('GmailMboxFile: done reading mbox file');
        onComplete();
    });
}
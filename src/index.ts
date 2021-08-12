// Info: The PATH to tshark have to be entered in the environment variables. For Windows it may be: "C:\Program Files\Wireshark\
  
import { exec, spawn} from 'child_process';
import { Connector } from "./connection";
import { BlockChainNetwork } from "./connectionInterfaces";

// import readline from 'readline';
import { read, realpathSync, writeFile, readFileSync } from 'fs';

import { Logger, Workstation, LogOptions } from './logging';

interface ConfigOptions {
    Blockchain: BlockChainNetwork, 
    WorkStation: Workstation, 
    LogOptions: LogOptions
};


/**
 * Print all available network devices to console
 */
async function getDevices()
{
    // Start command and get the full output
    exec("tshark -D", (err, stdout, stderr) => {
      if (err) {
        console.log(`Error: ${err}`);
        return;
      }

      // the *entire* stdout and stderr (buffered)
      console.log(`Availible devices:\n${stdout}`);
      if(stderr)
      {
        console.log(`stderr: ${stderr}`);
      }
    });
}


/**
 * Convert a string to a boolean
 * @param value Input value
 * @param errFunc A function which will be executed if no boolean was founf
 * @returns true if the value is true or 1 otherwise it returns false
 */
 function stringToBoolean(value: string, errFunc: Function): boolean{
    if(value == 'true' || value == '1') {
        return true;
    } if(value == 'false' || value == '0') {
        return false;
    } else {
        errFunc();
        return false;
    }   
}

// Default values
let saveConfig = false;
let startLogging = true;
let startBenchmark = false;
let benchmarkStartByteAmount = 20000;
let benchmarkstep = 1000;

// Set the defailt blockchain options
const dataNet: BlockChainNetwork = {
    endpoint: "http://localhost:8888/",
    contract: "datasafe",
    scope: "ac.hospital1",
    user: "op.room1",
    privateKey: "5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3"   // TODO: Will be unnecessary by including an extrernal signature provider
};

// Set the default workstation options
let workstation: Workstation = {
    ip: '192.168.0.80',
    port: 26501
}

// Set the default log options
let logOptions: LogOptions = {
    shouldEncrypt: true,
    maxRecordsPerTrx: 10,
    maxTrxContentSize: 20000,
    networkDevice: 'Ethernet'
}

let defaultConfigOptions: ConfigOptions = {
    Blockchain: dataNet,
    WorkStation: workstation,
    LogOptions: logOptions,  
};

// Get the config file if it exists and override the default config options
try{
    let configContent = readFileSync("config.json", 'utf8');
    try{
        let configOptions: ConfigOptions = JSON.parse(configContent);
        Object.assign(defaultConfigOptions, configOptions);
        console.log("Config file has been loaded.\n");
    } catch(err){
        console.log("Can't parse the config file. Adjust or delete the config.json file.\n");
        process.exit(1);
    }
} catch (err){
    console.log("No config file to read.\n");
}

// Set command line parameters
for(let i = process.argv.length - 1; i > 1; i-=2){
    let value = process.argv[i];
    switch(process.argv[i-1].toLowerCase()){
        case 'endpoint': dataNet.endpoint = value; break;
        case 'contract': dataNet.contract = value; break;
        case 'scope': dataNet.scope = value; break;
        case 'user': dataNet.user = value; break;
        case 'privatekey': dataNet.privateKey = value; break;
        case 'networkdevice': logOptions.networkDevice = value; break;
        case 'ws.ip': workstation.ip = value; break;
        case 'ws.port': 
          try{
              workstation.port = parseInt(value);
          } catch (err) {
              console.log('Cant parse ws.port.', err); 
              process.exit(1);
          } break;
        case 'maxrecordspertrx': 
            try{
              logOptions.maxRecordsPerTrx = parseInt(value);
            } catch (err){
              console.log('Cant parse maxRecordsPerTrx.', err); 
              process.exit(1);
            } break;
        case 'maxtrxcontentsize': 
            try{
                logOptions.maxTrxContentSize = parseInt(value);
            } catch (err){
                console.log('Cant parse maxTrxContentSize.', err); 
                process.exit(1);
            } break;
        case 'encrypt': logOptions.shouldEncrypt = stringToBoolean(value, ()=>{ console.log("Can't parse encrypt."); process.exit(1);}); break;
        case 'save': 
           saveConfig = stringToBoolean(value, ()=>{ console.log("Can't parse save."); process.exit(1);}); break;
        case 'start': 
            startLogging = stringToBoolean(value, ()=>{ console.log("Can't parse edit."); process.exit(1);}); break;
        case 'benchmark':
            benchmarkStartByteAmount = parseInt(value);
            startBenchmark = true;
            break;
            case 'benchstep':
                benchmarkstep = parseInt(value);
                break;
        default:
            // Options with only one parameter
            switch(value){
              case 'help':
                console.log('Parameters are: \nstart "[boolean]" | Start logging, \nsave "[boolean]" | Save the configuration in config.json, \n\nLog options: \nencrypt "[boolean]" | Encrypt the log, \nmaxRecordsPerTrx "[number]", \nmaxTrxContentSize "[number]", \n\nBlockchain options: \nendpoint "[string]", \ncontract "[string]", \nscope "[string]", \nuser "[string]", \nprivateKey "[string]", \nnetworkDevice "[string|number]", \n\nWorkstation options: \nws.ip "[string]", \nws.port "[number]", \n\nbenchmark "[number]" | Start benchmark by the given amount of bytes per transaction, \nbenchstep "[number]" |  While a benchmark this value represent the amount of bytes per transaction added after each round, \ngetdevices | Get available network devices, \nhelp | Get all command line parameters. \ninfo | Get infos of this project.');
                process.exit(0);
              case 'getdevices':
                getDevices();
                startLogging = false;
                break;
              case 'info':
                const pjson = require('../package.json');
                console.log(`SDC Sniffer ${pjson.version}\n${pjson.description} by ${pjson.author}\nLicence: ${pjson.license}\nIf you are interested to build on this project you are wellcome to contact me.`);
                process.exit(0);
              default: console.log('Unnown parameter: ', process.argv[i-1]); process.exit(1);
            }
    }
}

// Save the configuration in a config file
if(saveConfig){
    let jsonObj: ConfigOptions = {Blockchain: dataNet, WorkStation: workstation, LogOptions: logOptions};
    let jsonContent = JSON.stringify(jsonObj); 

    writeFile("config.json", jsonContent, 'utf8', function (err) {
        if (err) {
            console.log("An error occured while writing JSON Object to File.");
            return console.log(err);
        }
        console.log("JSON file has been saved.");
    });
}

if(startLogging){
    // Connect to the blockchain networks
    let connector = new Connector(dataNet, logOptions.shouldEncrypt);

    // Create the logger object
    let logger = new Logger(connector, logOptions, workstation);

    if(!startBenchmark){
        // Start the logger
        logger.startLogging();
    } else {
        logger.startBenchmarkLogging(benchmarkStartByteAmount, benchmarkstep);
    }
}


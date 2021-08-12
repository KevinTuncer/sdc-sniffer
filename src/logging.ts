import { spawn } from "child_process";
import WebSocket from "ws";
import { Connector } from "./connection";
import { JsonFormatLog } from "./connectionInterfaces";
import { StringConverter } from "./stringConversion";

export interface Workstation{
    ip: string;
    port: number;
}

export interface LogOptions{
    shouldEncrypt: boolean;
    networkDevice: number | string;
    maxRecordsPerTrx: number;
    maxTrxContentSize: number;
}

export class Logger
{
    private record: Array<JsonFormatLog> = [];      // Kepps all temp records 
    private recordSize = 0;                         // Keep the size of all records stored in the record array

    /**
     * Create a logger object which manages the recording of sdc traffic and messages from a workstation 
     * @param connector An object which manages the storing to a defined blockchain
     * @param options Options for logging
     * @param workstation Parameters to connect to a workstation per websocket
     */
    constructor(private connector: Connector, private options: LogOptions, private workstation?: Workstation){
    }

    /**
     * Initialize and start the logging of a workstation by websocket
     */
    WorkstationLogging(){
        if(typeof this.workstation === 'undefined'){
            console.log('No workstation defined.');
            return;
        }

        // Create socket
        let url = `ws://${this.workstation.ip}:${this.workstation.port}/`;
        console.log(`Open a websocket to Workstation ${url} and start recording.`);
        const socket  = new WebSocket(url);
      
        socket.onerror = function(event) {
          console.log(`Workstation ${event.error}`);
        };

        socket.onmessage = ({data}) => {
            if(typeof this.workstation === 'undefined'){
                return;
            }
            // Create record
            let entry: JsonFormatLog = {
                type: 'WS',
                ip: this.workstation.ip,
                port: this.workstation.port,
                timestamp: Date.now(),
                payload: data.toString()
            }
        
            console.log(`Workstation ${url}: ${data.toString()}`);
            
            this.record.push(entry);
            // Check if there are enough records to upload them
            this.CheckUploadRecord(this.record);
        }
    }
  
    /**
     * Initialize and start the logging of SDC network traffic
     */
    SDCLogging(){
        if(typeof this.options.networkDevice === 'undefined'){
            console.log('No network device is defined.');
            return;
        }

        console.log(`Start recording of xml messages.`);
        
        // Start sniffing the network
        let options = ['-i', this.options.networkDevice.toString(), '-T', 'ek', '-e', /*'frame.number', '-e',*/ 'ip.addr', '-e', 'ipv6.addr', '-e', 'tcp.port','-e', 'udp.port',/*'-e', 'udp',*/ /*'-e', '_ws.col.Info',*/ '-e', 'tcp.payload', '-e', 'udp.payload'];
        options.push('-Y' ,'frame contains "<?xml"'); // Add DisplayFilter
        const child = spawn('tshark', options);
        
        let tempStr = ''; // Temporary variable to combine splitted messages
        
        child.stdout.on('data', (chunk: any) => {
            // Convert Object
            let end = 0;
            let start = 0;
            tempStr += chunk;
            let lastEnd = tempStr.length;
            while(start != -1)
            {
            // Break if this message is not complete yet
            start = tempStr.indexOf('{"timestamp":', end);
            if(start == -1) {
                break;
            }
            end = tempStr.indexOf(']}}', start) + 3;
            if(end - 3 == -1) {
                break;
            }
            
            // Convert to object and add to array
            let substr = tempStr.substring(start, end);
            try{
                let entry = StringConverter.convertMessage({data: substr});
                this.record.push(entry);
                this.recordSize += (entry.payload as string).length;
        
                // Output the last object
                if(this.record.length > 0)
                {
                let lastObj = this.record[this.record.length - 1];  
                console.log(`Output:\nTimestamp:${lastObj.timestamp} | ${lastObj.ip.concat()} | ${lastObj.protocol}`);
                //console.log(`${lastObj.payload}\n`);
                }
            }
            catch(e)
            {
                console.log(`${e}: ${substr}`);
                break;
            }
                lastEnd = end;
                start = end;
            }
        
            // Keep the rest of the string for the next incomming message
            tempStr = tempStr.substring(lastEnd);
            // Check if there are enough records to upload them
            this.CheckUploadRecord(this.record);
        });
        
        child.stderr.on( 'data', (data: any) => {
            console.log( `stderr: ${data}` );
        } );
        
        child.on('close', (code: any) => {
            console.log(`child process exited with code ${code}.`);
        });
    }

    /**
     * Start the logging of a workstation and the SDC network traffic
     * @param device is the networkadapter defined by its name oder its number defined by tshark
     */
    async startLogging() {
        // Clear 
        this.record.length = 0;  // ECMA Script to clear an array
        this.recordSize = 0;                

        // Initialze and start the logging of the workstation and the sdc network traffic
        console.log('Start Logging.');
        this.WorkstationLogging();
        this.SDCLogging();
    }

    /**
     * Start the logging of a workstation and the SDC network traffic
     * @param device is the networkadapter defined by its name oder its number defined by tshark
     */
     async startBenchmarkLogging(startByte: number, stepLength: number) {
        // Clear 
        this.record.length = 0;  // ECMA Script to clear an array
        this.recordSize = 0;                

        // Initialze and start the benchmark logging
        console.log(`Start Benchmark Logging at ${startByte} bytes and added ${stepLength} bytes per round.`);
        this.uploadTest(this, {trxLength: startByte, stepLength: stepLength}, (new Date).getTime());        
    }

    uploadTest(logger: Logger, option: {trxLength: number, stepLength: number}, startTime: number){
        if(!logger.connector.isUploading()) {
            const amount = 20;
            let delta = ((new Date).getTime() - startTime) / amount;
            console.log(`${delta} milliseconds per transaction. ${option.trxLength / delta} KB/s.`);

            // Create data
            let testData = { data: '#'.repeat(option.trxLength) };
            console.log(`Start transactions with ${option.trxLength} bytes.`);
            
            // Upload
            for(let i = 0 ; i < amount; ++i){
                logger.connector.AddLog(testData);
            }

            option.trxLength += option.stepLength;
            startTime = (new Date).getTime();
        }
        setTimeout(logger.uploadTest, 10, logger, option, startTime);
    }

    /**
     * Add records to upload but wait until a defined amount of records is reached and upload them together in a single transaction
     * @param record is an array of logs to upload
     */
    CheckUploadRecord(record: Array<JsonFormatLog>) {
        // Return if there are not enough entries and not enough storrage collected
        if(record.length < this.options.maxRecordsPerTrx && this.recordSize < this.options.maxTrxContentSize) {
            return; 
        }
        
        console.log(`Prepare ${record.length} recorded messages for uploading.`);
        
        // Add the record in reversed order because newer actions should be first. Furthermore it starts logging if it is not running already
        this.connector.AddLog({ data: JSON.stringify(record.reverse()) });

        // Remove all records
        record.length = 0;
    }
}
import { JsonFormatLog } from "./connectionInterfaces";

export class StringConverter
{
    /**
     * Convert each hex value which is stored as readable string to a character
     * @param hex String with readable hex values
     * @returns the corresponding characters in a string
     */
    static hex2a(hex: string) : string {
        let str = '';
        for (let i = 0; (i < hex.length && hex.substr(i, 2) !== '00'); i += 2)
            str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        return str;
    }

    /**
     * Convert an object which contains ports as string in an object which contains the ports as numbers
     * @param ports The port as string or several ports as string array
     * @returns a port as number or several ports as number array
     */
    static portsStringToNumbers(ports: Array<string> | string): Array<number> | number {
        if(typeof ports === 'string'){
        return  parseInt(ports);
        } else {
        let portnumbers: Array<number> = [];
        for(let p of ports){
            portnumbers.push(parseInt(p));
        }
        return portnumbers;
        }
    }

    /**
     * Convert the message as json string to an object with the needed format for saving
     * @param message A JavaScript object to get a string by referrence
     * @param data A string with the data which will be used for converting
     * @returns a standardized object, see JsonFormatLog
     */
    static convertMessage(message: {data:string}): JsonFormatLog {
        // Parse to a JSON object
        let tempJSON = JSON.parse(message.data);
        
        // Get ip
        let ip: any;
        if(typeof tempJSON.layers.ip_addr !== 'undefined'){
        ip = tempJSON.layers.ip_addr;
        } else if (typeof tempJSON.layers.ipv6_addr !== 'undefined'){
        ip = tempJSON.layers.ipv6_addr;
        } else {
        throw new Error("Contains no ip address");
        }
    
        // Get payload and protocol. Only TCP and UDP are possible. The payload will be converted to char array
        let protocol = "";
        let payload: string; //Array<string> = [];
        let port: Array<number> | number = NaN;
        if(typeof tempJSON.layers.tcp_payload != "undefined")
        {
        protocol = "TCP";
        if((tempJSON.layers.tcp_payload as Array<string>).length > 1){
            throw new Error("TCP payload with more than one entry");
        }
        //(tempJSON.layers.tcp_payload as Array<string>).forEach(element => payload.push(hex2a(element)))
        payload = StringConverter.hex2a((tempJSON.layers.tcp_payload as Array<string>)[0]);
    
        // set port
        if(tempJSON.layers.tcp_port){
            port = StringConverter.portsStringToNumbers(tempJSON.layers.tcp_port);
        }
        }
        else if(typeof tempJSON.layers.udp_payload != "undefined")
        {
        protocol = "UDP";
        if((tempJSON.layers.udp_payload as Array<string>).length > 1){
            throw new Error("UDP payload with more than one entry");
        }
        //(tempJSON.layers.udp_payload as Array<string>).forEach(element => payload.push(hex2a(element)))
        payload = StringConverter.hex2a((tempJSON.layers.udp_payload as Array<string>)[0]);
    
        // set port
        if(tempJSON.layers.udp_port){
            port = StringConverter.portsStringToNumbers(tempJSON.layers.udp_port);
        }
        }
        else {
        throw new Error("No known protocol");
        }
    
        // Create the formatted object
        let fromattedObject: JsonFormatLog = {
        type: 'SDC',
        timestamp: tempJSON.timestamp,
        ip: ip,
        protocol: protocol,
        payload: payload  // TODO: Check if better as array
        }
    
        // Don't add the port if it is not an array and not a number 
        if (typeof port !== 'number' || !isNaN(port)) { 
        fromattedObject.port = port; 
        }
        
        return fromattedObject;
    }
}
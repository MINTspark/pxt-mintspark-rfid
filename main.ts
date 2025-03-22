let rfid_reader_i2c_address = (0x48 >> 1);
let receiveBuffer = pins.createBuffer(32);
let receiveAcknowledgement = pins.createBuffer(8);
let acknowledgementBuffer = pins.createBuffer(6);
let uId = pins.createBuffer(7);
let passwordBuffer = pins.createBuffer(6);
let blockData = pins.createBuffer(16);
let rfid_enabled = 0;
let uIdLength = 0;
let errorString = "";
acknowledgementBuffer[0] = 0x00;
acknowledgementBuffer[1] = 0x00;
acknowledgementBuffer[2] = 0xFF;
acknowledgementBuffer[3] = 0x00;
acknowledgementBuffer[4] = 0xFF;
acknowledgementBuffer[5] = 0x00;
passwordBuffer[0] = 0xFF;
passwordBuffer[1] = 0xFF;
passwordBuffer[2] = 0xFF;
passwordBuffer[3] = 0xFF;
passwordBuffer[4] = 0xFF;
passwordBuffer[5] = 0xFF;

function readDataBlock(blockToRead: number): string {
    if (!initialiseCard(blockToRead))
    {
        return errorString;
    }

    let cmdRead: number[] = []
    cmdRead = [0x00, 0x00, 0xff, 0x05, 0xfb, 0xD4, 0x40, 0x01, 0x30, 0x07, 0xB4, 0x00];
    let sum = 0, count = 0;
    cmdRead[9] = blockToRead;
    for (let i = 0; i < cmdRead.length - 2; i++) {
        if ((i === 3) || (i === 4)) {
            continue;
        }
        sum += cmdRead[i];
    }
    cmdRead[cmdRead.length - 2] = 0xff - sum & 0xff;
    let buf = pins.createBufferFromArray(cmdRead)
    writeAndReadBuf(buf, 31);
    let ret = "";
    if ((receiveBuffer[6] === 0xD5) && (receiveBuffer[7] === 0x41) && (receiveBuffer[8] === 0x00) && (checkDcs(31 - 4))) {
        for (let i = 0; i < 16; i++) {
            if (receiveBuffer[i + 9] >= 0x20 && receiveBuffer[i + 9] < 0x7f) {
                ret += String.fromCharCode(receiveBuffer[i + 9]) // valid ascii
            }
        }
        return ret;
    }
    return "No Data"
}

function writeData(data: string, blockToWrite:number): void {
    if (!initialiseCard(blockToWrite)) {
        return;
    }

    let len = data.length
    if (len > 16) {
        len = 16
    }
    for (let i = 0; i < len; i++) {
        blockData[i] = data.charCodeAt(i)
    }

    writeblock(blockData, blockToWrite);
}

function checkCard(): boolean {
    if (rfid_enabled === 0) {
        wakeup();
    }

    let buf: number[] = [];
    buf = [0x00, 0x00, 0xFF, 0x04, 0xFC, 0xD4, 0x4A, 0x01, 0x00, 0xE1, 0x00];
    let cmdUid = pins.createBufferFromArray(buf);
    writeAndReadBuf(cmdUid, 24);
    for (let i = 0; i < 4; i++) {
        if (receiveAcknowledgement[1 + i] != acknowledgementBuffer[i]) {
            return false;
        }
    }

    uIdLength = receiveBuffer[13];

    if ((receiveBuffer[6] != 0xD5) || (!checkDcs(24 - 4))) {

        basic.showIcon(IconNames.Heart)
    }
    for (let i = 0; i < uId.length; i++) {
        uId[i] = receiveBuffer[14 + i];
    }

    if (uId[0] === uId[1] && uId[1] === uId[2] && uId[2] === uId[3] && uId[3] === 0xFF) {
        return false;
    }

    return true;
}

function writeAndReadBuf(buf: Buffer, len: number) {
    pins.i2cWriteBuffer(rfid_reader_i2c_address, buf);
    basic.pause(100);
    receiveAcknowledgement = pins.i2cReadBuffer(rfid_reader_i2c_address, 8);
    basic.pause(100);
    receiveBuffer = pins.i2cReadBuffer(rfid_reader_i2c_address, len - 4);
}

function checkDcs(len: number): boolean {
    let sum = 0, dcs = 0;
    for (let i = 1; i < len - 2; i++) {
        if ((i === 4) || (i === 5)) {
            continue;
        }
        sum += receiveBuffer[i];
    }
    dcs = 0xFF - (sum & 0xFF);
    if (dcs != receiveBuffer[len - 2]) {
        return false;
    }
    return true;
}
function passwdCheck(id: Buffer, st: Buffer, blockToCheck:number): boolean {
    if (uIdLength == 7)
    {
        // NTAG or Ultralight - no authentication
        return true;
    }

    let buf: number[] = [];
    buf = [0x00, 0x00, 0xFF, 0x0F, 0xF1, 0xD4, 0x40, 0x01, 0x60, 0x07, 0xFF,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xD1, 0xAA, 0x40, 0xEA, 0xC2, 0x00];
    let cmdPassWord = pins.createBufferFromArray(buf);
    let sum = 0, count = 0;
    cmdPassWord[9] = blockToCheck;
    for (let i = 10; i < 16; i++)
        cmdPassWord[i] = st[i - 10];
    for (let i = 16; i < 20; i++)
        cmdPassWord[i] = id[i - 16];
    for (let i = 0; i < 20; i++) {
        if (i === 3 || i === 4) {
            continue;
        }
        sum += cmdPassWord[i];
    }
    cmdPassWord[20] = 0xff - (sum & 0xff)
    writeAndReadBuf(cmdPassWord, 15);
    for (let i = 0; i < 4; i++) {
        if (receiveAcknowledgement[1 + i] != acknowledgementBuffer[i]) {
            serial.writeLine("psd ack ERROR!");
            return false;
        }
    }
    if ((receiveBuffer[6] === 0xD5) && (receiveBuffer[7] === 0x41) && (receiveBuffer[8] === 0x00) && (checkDcs(15 - 4))) {
        return true;
    }
    return false;
}

function initialiseCard(blockToUse: number): boolean {
    if (rfid_enabled === 0) {
        wakeup();
    }

    if (checkCard() === false) {
        errorString = "No Card";
        return false;
    }

    if (uIdLength == 4 && !passwdCheck(uId, passwordBuffer, blockToUse)) {
        errorString = "Password Error";
        return false;
    }

    return true;
}

function wakeup() {
    basic.pause(100);
    let i = 0;
    let buf: number[] = [];
    buf = [0x00, 0x00, 0xFF, 0x05, 0xFB, 0xD4, 0x14, 0x01, 0x14, 0x01, 0x02, 0x00];
    let cmdWake = pins.createBufferFromArray(buf);
    writeAndReadBuf(cmdWake, 14);
    for (i = 0; i < acknowledgementBuffer.length; i++) {
        if (receiveAcknowledgement[1 + i] != acknowledgementBuffer[i]) {
            break;
        }
    }

    rfid_enabled = 1;  
    basic.pause(100);
}

function writeblock(data: Buffer, blockToWrite :number): void {
    if (!passwdCheck(uId, passwordBuffer, blockToWrite))
    {
        return;
    }

    basic.showIcon(IconNames.Happy)
    let cmdWrite: number[] = [0x00, 0x00, 0xff, 0x15, 0xEB, 0xD4, 0x40, 0x01, 0xA0,
        0x06, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
        0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0xCD,
        0x00];
    let sum = 0, count = 0;
    cmdWrite[9] = blockToWrite;
    for (let i = 10; i < 26; i++)
        cmdWrite[i] = data[i - 10];
    for (let i = 0; i < 26; i++) {
        if ((i === 3) || (i === 4)) {
            continue;
        }
        sum += cmdWrite[i];
    }
    cmdWrite[26] = 0xff - (sum & 0xff);
    let tempbuf = pins.createBufferFromArray(cmdWrite)
    writeAndReadBuf(tempbuf, 16);
}


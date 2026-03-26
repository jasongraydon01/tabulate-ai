function toUtf16LeBomBuffer(text: string): Buffer {
  const body = Buffer.from(text.replace(/\n/g, '\r\n'), 'utf16le');
  return Buffer.concat([Buffer.from([0xFF, 0xFE]), body]);
}

export function buildReferenceWinCrossJobBuffer(): Buffer {
  const text = [
    '[VERSION]',
    '25.0',
    '',
    '[PREFERENCES]',
    '250,250,50,100,1,2,3,4,6,13,5,7,Courier New,11',
    '5TB=Top #N Box,5BB=Bottom #N Box,SM=Mean,SD=Median,SV=Standard Deviation,SR=Standard Error,TN=Total,SB=SBase',
    'Mean,Median,Standard Deviation,Standard Error,N,Grouped Median',
    'OS,OR,OV,OI2,O%,SF,RV,ST,S1,P0,V1,SA,SP',
    'Total^TN^1',
    '',
    '[SIGFOOTER]',
    'Significance tested at 95% confidence level.',
    'Letters indicate statistically significant differences.',
    '',
    '[TABLES]',
    'T1^1',
    ' OS,OR,OV,OI2,O%,SF,RV,ST,S1,P0,V1,SA,SP',
    ' Demo table',
    'SBase: Total',
    ' Item 1^             Q1r1 (1)',
    ' Mean           ^Q1 1-5^SM',
    'USE=T2',
    'AF=Q1r1,Q1r2',
    '',
    '[BANNERS]',
    '*Banner1',
    ' ID:1',
    ' SW:1,15,1,15',
    ' HP:1,1',
    ' PT:2,1',
    ' TN^W70',
    ' S5 (1)^W70',
    ' S5 (3)^W70',
    '  ............... ............... ...............',
    '                    Specialty',
    '  ............... ............... ...............',
    '  Total           Primary Care    Pediatrician',
    '',
    '[TITLE]',
    'Reference profile',
  ].join('\n');

  return toUtf16LeBomBuffer(text);
}

export function buildRawWinCrossJobBuffer(): Buffer {
  const text = [
    '[VERSION]',
    '25.0',
    '',
    '[PREFERENCES]',
    '0,0,0,0,0',
    'SM=Mean,SD=Median,SV=StdDev,SR=StdErr,TN=Total,SB=SBase',
    'Mean,Median,StdDev,StdErr,N',
    'OS,OR,OV,OI2,O%',
    'Total^TN^1',
    '',
    '[TABLES]',
    'T1^1',
    ' OS,OR,OV,OI2,O%',
    ' Raw table',
    'SBase: Total',
    ' Item 1^             Q1r1 (1)',
    '',
    '[BANNERS]',
    '*Banner1',
    ' TN',
    '',
    '[TITLE]',
    'Raw profile',
  ].join('\n');

  return toUtf16LeBomBuffer(text);
}

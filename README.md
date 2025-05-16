# SolarLog-Node
SolarLog-Node is a Node.js library for interacting with SolarLog devices. It provides a simple interface to retrieve data from the local SolarLog API.

## Usage
```javascript
import SolarLog from 'solarlog';


const solarLog = new SolarLog ('host', ['meter1, meter2'], 'username', 'password');

const current_production = await solarLog.getProduction();
const today = await solarLog.getToday();
const daily = await solarLog.getDaily();
const monthly = await solarLog.getMonthly();
const yearly = await solarLog.getYearly();

```


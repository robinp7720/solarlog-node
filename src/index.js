import Axios from 'axios';

// The following values are used to request data from the SolarLog
// The values are used as keys in the request Object
// They are, to my knowledge, not documented anywhere and completely
// arbitrary.
// Whoever came up with this system should be ashamed of themselves.
export const REQ = {
    something2: 100,
    smtpServer: 101,
    username: 102,
    someString: 103,
    fromAddress: 104,
    toAddress: 105,
    someTime: 106,
    test: 107,
    version: 137,
    info: 801,
    status: 608,
    something: 771, // No parameters
    production: 782, // No parameters
    today: 776,
    daily: 777,
    monthly: 877,
    yearly: 878,
};

export default class SolarLog {
    constructor(url, inverters, loginInfo) {
        this.url = url;
        this.inverters = inverters;
        this.cookies = null;
        this.username = loginInfo.username;
        this.password = loginInfo.password;

        this.rate_limit_last_login = 0;

        // Amount of times to attempt login.
        // Must be at least 1
        this.login_attempt_count = 1;

        this.axios = Axios.create(
            {
                baseURL: `http://${url}`,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-SL-CSRF-PROTECTION': '1',
                    'Priority': 'u=0',
                    'Accept': '*/*',
                    'Accept-Language': 'en-US,en;q=0.7,de-DE;q=0.3',
                }
            }
        );
    }

    async login() {
        if (this.rate_limit_last_login + (1000 * 60 * 60 * 3) > Date.now()) {
            throw new Error('Rate limited');
        }

        this.rate_limit_last_login = Date.now();


        const login = {
            u: this.username,
            p: this.password,
        };

        const serilize = (obj) => Object.keys(obj).map(key => `${key}=${obj[key]}`).join('&');

        // Why is this using fetch instead of axios?
        // Because the SolarLog API doesn't play nice with web standards.
        // The body of the request not actually URL encoded, but rather
        // a string of key value pairs separated by '&'.
        // This is not a problem for fetch, but axios will URL encode the
        // body, which will cause the SolarLog to reject the request.
        const res = await fetch(`http://${this.url}/login`, {
            "credentials": "include",
            "headers": {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.7,de-DE;q=0.3",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Priority": "u=0"
            },
            "referrer": "http://137.226.13.253/",
            "body": serilize(login),
            "method": "POST",
            "mode": "cors"
        });

        // Parse the cookies from the response
        const cookies = res.headers.get('set-cookie').split(',');

        // Set the cookie for the axios instance
        // This is necessary to keep the session alive
        const cookie = cookies.map(cookie => cookie.split(';')[0]).join(';');
        this.axios.defaults.headers.common['Cookie'] = cookie;
        this.cookies = cookie;

        // return body
        return res.text();
    }

    getCodeFor(key, keys = REQ) {
        for (let [k, v] of Object.entries(keys)) {
            if (v === parseInt(key)) {
                return k;
            }
        }
    }

    formatResponse(data, keys = REQ) {
        let res = {};

        for (let key in data) {
            const item = this.getCodeFor(key, keys);

            res[item] = data[key];
        }

        return res;
    }

    async get(params) {
        let { data } = await this.axios.post('/getjp', params);

        // Why couldn't they send sensible status codes back?
        // The only indication that the session cookie is not valid anymore is the fact that the response contains "ACCESS DENIED"
        // This is why have this beauty.
        // Try to login 3 times. If we still fail... something's completely broken.
        for (let i = 0; i < this.login_attempt_count; i++ ) {
            if (!JSON.stringify(data).includes('ACCESS DENIED')) {
                break;
            }
            
            await this.login();

            data = (await this.axios.post('/getjp', params)).data;
        }

        if (JSON.stringify(data).includes('ACCESS DENIED')) {
            throw new Error();
        }

        return this.formatResponse(data);
    }

    async getStatus() {
        return await this.get({ [REQ.status]: null });
    }

    async formatTimeoutput(data, format = this.inverters) {
        let res = {};

        for (let i of data) {
            res[i[0]] = i.filter((v,i) => i > 0 && format[i-1]).reduce((acc, v, i) => ({...acc, [format[i]]: v}),{});
        }

        return res;
    }

    async getInfo() {
        // 101: Build version and number
        // 102: Build Date
        // 781: Unkown
        // There are some other values that haven't been documented yet
        // I crashed the solarlog by requesting them....

        const INFO = {version: 101, buildDate: 102}

        let {info} = await this.get({ [REQ.info]: {[INFO.version]: null, [INFO.buildDate]: null} });

        return this.formatResponse(info, INFO);
    }


    async getProduction() {
        return this.assignDevices((await this.get({ [REQ.production]: null })).production);
    }

    assignDevices(input) {
        const output = {};

        for (const [key, value] of Object.entries(input)) {
            if (!this.inverters[key]) {
                continue;
            }

            output[this.inverters[key]] = value;
        }

        return output;
    }

    async getToday() {
        const today = (await this.get({ [REQ.today]: { 0: null } })).today[0];

        let output = [];

        for (let [key, value] of Object.entries(today)) {
            let devices = {};

            for (let i = 0; i < value[1].length; i++) {
                if (!this.inverters[i]) continue;
                devices[this.inverters[i]] = value[1][i];
            }

            output.push({
                time: value[0],
                devices
            });
        }


        return output;
    }

    async getDaily() {
        return await this.formatTimeoutput(
            // The data returned is an array containing arrays of the following
            // structure: [date, [values]]
            // To make this work with the formatTimeoutput function, we need to
            // flatten the array and add the date to the beginning of the
            // arrays.
            // Why? Because I wrote the function to match the output of the
            // monthly and yearly requests.
            Object.values((await this.get({ [REQ.daily]: { 0: null, 31: null } })).daily).flat().map(([date, values]) => [date, ...values]),
        );

    }

    async getMonthly() {
        return await this.formatTimeoutput((await this.get({ [REQ.monthly]: null })).monthly, ['production', 'consumption', 'self_consumption']);
    }

    async getYearly() {
        return await this.formatTimeoutput((await this.get({ [REQ.yearly]: null })).yearly, ['production', 'consumption', 'self_consumption']);
    }
};

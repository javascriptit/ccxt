"use strict";

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange')
const { ExchangeError, InsufficientFunds, OrderNotFound, DDoSProtection } = require ('./base/errors')

//  ---------------------------------------------------------------------------

module.exports = class luno extends Exchange {

    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'luno',
            'name': 'luno',
            'countries': [ 'GB', 'SG', 'ZA' ],
            'rateLimit': 3000,
            'version': '1',
            'hasCORS': false,
            'hasFetchTickers': true,
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/27766607-8c1a69d8-5ede-11e7-930c-540b5eb9be24.jpg',
                'api': 'https://api.mybitx.com/api',
                'www': 'https://www.luno.com',
                'doc': [
                    'https://www.luno.com/en/api',
                    'https://npmjs.org/package/bitx',
                    'https://github.com/bausmeier/node-bitx',
                ],
            },
            'api': {
                'public': {
                    'get': [
                        'orderbook',
                        'ticker',
                        'tickers',
                        'trades',
                    ],
                },
                'private': {
                    'get': [
                        'accounts/{id}/pending',
                        'accounts/{id}/transactions',
                        'balance',
                        'fee_info',
                        'funding_address',
                        'listorders',
                        'listtrades',
                        'orders/{id}',
                        'quotes/{id}',
                        'withdrawals',
                        'withdrawals/{id}',
                    ],
                    'post': [
                        'accounts',
                        'postorder',
                        'marketorder',
                        'stoporder',
                        'funding_address',
                        'withdrawals',
                        'send',
                        'quotes',
                        'oauth2/grant',
                    ],
                    'put': [
                        'quotes/{id}',
                    ],
                    'delete': [
                        'quotes/{id}',
                        'withdrawals/{id}',
                    ],
                },
            },
        })
    }

    async fetchMarkets () {
        let markets = await this.publicGetTickers ();
        let result = [];
        for (let p = 0; p < markets['tickers'].length; p++) {
            let market = markets['tickers'][p];
            let id = market['pair'];
            let base = id.slice (0, 3);
            let quote = id.slice (3, 6);
            base = this.commonCurrencyCode (base);
            quote = this.commonCurrencyCode (quote);
            let symbol = base + '/' + quote;
            result.push ({
                'id': id,
                'symbol': symbol,
                'base': base,
                'quote': quote,
                'info': market,
            });
        }
        return result;
    }

    async fetchBalance (params = {}) {
        await this.loadMarkets ();
        let response = await this.privateGetBalance ();
        let balances = response['balance'];
        let result = { 'info': response };
        for (let b = 0; b < balances.length; b++) {
            let balance = balances[b];
            let currency = this.commonCurrencyCode (balance['asset']);
            let reserved = parseFloat (balance['reserved']);
            let unconfirmed = parseFloat (balance['unconfirmed']);
            let account = {
                'free': parseFloat (balance['balance']),
                'used': this.sum (reserved, unconfirmed),
                'total': 0.0,
            };
            account['total'] = this.sum (account['free'], account['used']);
            result[currency] = account;
        }
        return this.parseBalance (result);
    }

    async fetchOrderBook (symbol, params = {}) {
        await this.loadMarkets ();
        let orderbook = await this.publicGetOrderbook (this.extend ({
            'pair': this.marketId (symbol),
        }, params));
        let timestamp = orderbook['timestamp'];
        return this.parseOrderBook (orderbook, timestamp, 'bids', 'asks', 'price', 'volume');
    }

    parseTicker (ticker, market = undefined) {
        let timestamp = ticker['timestamp'];
        let symbol = undefined;
        if (market)
            symbol = market['symbol'];
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': undefined,
            'low': undefined,
            'bid': parseFloat (ticker['bid']),
            'ask': parseFloat (ticker['ask']),
            'vwap': undefined,
            'open': undefined,
            'close': undefined,
            'first': undefined,
            'last': parseFloat (ticker['last_trade']),
            'change': undefined,
            'percentage': undefined,
            'average': undefined,
            'baseVolume': undefined,
            'quoteVolume': parseFloat (ticker['rolling_24_hour_volume']),
            'info': ticker,
        };
    }

    async fetchTickers (symbols = undefined, params = {}) {
        await this.loadMarkets ();
        let response = await this.publicGetTickers (params);
        let tickers = this.indexBy (response['tickers'], 'pair');
        let ids = Object.keys (tickers);
        let result = {};
        for (let i = 0; i < ids.length; i++) {
            let id = ids[i];
            let market = this.markets_by_id[id];
            let symbol = market['symbol'];
            let ticker = tickers[id];
            result[symbol] = this.parseTicker (ticker, market);
        }
        return result;
    }

    async fetchTicker (symbol, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let ticker = await this.publicGetTicker (this.extend ({
            'pair': market['id'],
        }, params));
        return this.parseTicker (ticker, market);
    }

    parseTrade (trade, market) {
        let side = (trade['is_buy']) ? 'buy' : 'sell';
        return {
            'info': trade,
            'id': undefined,
            'order': undefined,
            'timestamp': trade['timestamp'],
            'datetime': this.iso8601 (trade['timestamp']),
            'symbol': market['symbol'],
            'type': undefined,
            'side': side,
            'price': parseFloat (trade['price']),
            'amount': parseFloat (trade['volume']),
        };
    }

    async fetchTrades (symbol, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let response = await this.publicGetTrades (this.extend ({
            'pair': market['id'],
        }, params));
        return this.parseTrades (response['trades'], market);
    }

    async createOrder (market, type, side, amount, price = undefined, params = {}) {
        await this.loadMarkets ();
        let method = 'privatePost';
        let order = { 'pair': this.marketId (market) };
        if (type == 'market') {
            method += 'Marketorder';
            order['type'] = side.toUpperCase ();
            if (side == 'buy')
                order['counter_volume'] = amount;
            else
                order['base_volume'] = amount;
        } else {
            method += 'Order';
            order['volume'] = amount;
            order['price'] = price;
            if (side == 'buy')
                order['type'] = 'BID';
            else
                order['type'] = 'ASK';
        }
        let response = await this[method] (this.extend (order, params));
        return {
            'info': response,
            'id': response['order_id'],
        };
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        await this.loadMarkets ();
        return await this.privatePostStoporder ({ 'order_id': id });
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.urls['api'] + '/' + this.version + '/' + this.implodeParams (path, params);
        let query = this.omit (params, this.extractParams (path));
        if (Object.keys (query).length)
            url += '?' + this.urlencode (query);
        if (api == 'private') {
            let auth = this.encode (this.apiKey + ':' + this.secret);
            auth = this.stringToBase64 (auth);
            headers = { 'Authorization': 'Basic ' + this.decode (auth) };
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    async request (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let response = await this.fetch2 (path, api, method, params, headers, body);
        if ('error' in response)
            throw new ExchangeError (this.id + ' ' + this.json (response));
        return response;
    }
}
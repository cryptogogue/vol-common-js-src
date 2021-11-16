// Copyright (c) 2020 Cryptogogue, Inc. All Rights Reserved.

import { RevocableContext }             from 'fgc';
import _                                from 'lodash';
import { action, computed, observable, runInAction } from 'mobx';
import url                              from 'url';

//const debugLog = function () {}
const debugLog = function ( ...args ) { console.log ( '@CONSENSUS:', ...args ); }

const DEFAULT_THRESHOLD     = 1.0;
const DEFAULT_TIMEOUT       = 5000;
const LATENCY_SAMPLE_SIZE   = 10;

//================================================================//
// ConsensusService
//================================================================//
export class ConsensusService {

    @observable error;

    @observable genesis;
    @observable identity;
    @observable digest;
    @observable height;
    @observable nextHeight;

    @observable minersByID          = {};

    @observable pendingURLs         = [];
    @observable scannedURLs         = {};

    @observable ignored             = {};
    @observable threshold           = DEFAULT_THRESHOLD;

    @observable serviceCountdown    = 1.0;

    @computed get           currentMiners           () { return this.onlineMiners.filter (( miner ) => { return miner.digest === this.digest; }); }
    @computed get           currentURLs             () { return this.currentMiners.map (( miner ) => { return miner.url; }); }
    @computed get           ignoredIDs              () { return Object.keys ( this.minersByID ).filter (( minerID ) => { return this.ignored [ minerID ]; }); }
    @computed get           isBlocked               () { return (( this.onlineMiners.length > 0 ) && ( this.currentMiners.length === 0 )); }
    @computed get           miners                  () { return Object.values ( this.minersByID ); }
    @computed get           onlineMiners            () { return this.miners.filter (( miner ) => { return ( miner.online && !this.isIgnored ( miner.minerID )); }); }
    @computed get           onlineURLs              () { return this.onlineMiners.map (( miner ) => { return miner.url; }); }

    //----------------------------------------------------------------//
    @action
    async affirmMiner ( minerID, nodeURL ) {

        const miner = this.minersByID [ minerID ] || {};

        if ( miner.url ) {
            miner.url = nodeURL;
            return;
        }

        miner.minerID           = minerID;
        miner.height            = this.height;
        miner.nextHeight        = this.nextHeight;
        miner.total             = 0;            // total blocks
        miner.url               = nodeURL;
        miner.online            = true;         // assume miner is online until proven otherwise
        miner.latency           = 0;

        miner.digest            = this.digest;
        miner.nextDigest        = false;

        miner.build             = 0;
        miner.commit            = 0;
        miner.acceptedRelease   = 0;
        miner.nextRelease       = 0;

        this.minersByID [ minerID ] = miner;
    }

    //----------------------------------------------------------------//
    @action
    affirmNodeURLs ( nodeURLs ) {

        nodeURLs = ( typeof ( nodeURLs ) === 'string' ) ? [ nodeURLs ] : nodeURLs;

        for ( let nodeURL of nodeURLs ) {

            nodeURL             = url.parse ( nodeURL );
            nodeURL.pathname    = `/`;
            nodeURL             = url.format ( nodeURL );

            if ( !this.scannedURLs [ nodeURL ]) {
                this.pendingURLs.push ( nodeURL );
            }
        }
    }

    //----------------------------------------------------------------//
    constructor ( ignored ) {

        this.revocable = new RevocableContext ();
        this.reset ();
    }

    //----------------------------------------------------------------//
    @action
    async discoverMinersAsync () {

        while ( this.pendingURLs.length > 0 ) {
            await this.discoverMinersSinglePassAsync ();
        }
    }

    //----------------------------------------------------------------//
    @action
    async discoverMinersSinglePassAsync () {

        const checkMiner = async ( nodeURL ) => {

            try {

                const confirmURL            = url.parse ( nodeURL );
                confirmURL.pathname         = `/`;

                let result = await this.revocable.fetchJSON ( url.format ( confirmURL ));

                if ( result.minerID ) {
                    if ( result.genesis === this.genesis ) {
                        this.affirmMiner ( result.minerID, nodeURL, result.genesis );
                        await this.updateMinerAsync ( result.minerID );
                    }
                }
            }
            catch ( error ) {
                debugLog ( error );
            }
        }

        const promises = [];
        runInAction (() => {
            for ( let nodeURL of this.pendingURLs ) {
                this.scannedURLs [ nodeURL ] = true;
                promises.push ( checkMiner ( nodeURL ));
            }
            this.pendingURLs = [];
        });
        await this.revocable.all ( promises );
    }

    //----------------------------------------------------------------//
    findConsensus () {

        if ( this.height === this.nextHeight ) return;

        const miners = this.miners.filter (( miner ) => { return miner.nextHeight === this.nextHeight; });
        if ( !miners.length ) return;

        let bestCount = 0;
        let bestDigest = false;

        // build a histogram of digests at next height
        const histogram = {}; // counts by digest
        for ( let miner of miners ) {

            if ( !miner.nextDigest ) continue;

            const count = ( histogram [ miner.nextDigest ] || 0 ) + 1;
            histogram [ miner.nextDigest ] = count;

            if ( bestCount < count ) {
                bestCount   = count;
                bestDigest  = miner.nextDigest;
            }
        }

        const consensusRatio = bestCount / miners.length;

        if ( consensusRatio < this.threshold ) return false;

        for ( let miner of miners ) {
            if ( miner.nextDigest === bestDigest ) {
                miner.height    = this.nextHeight;
                miner.digest    = bestDigest;
            }
        }

        this.height = this.nextHeight;
        this.digest = bestDigest;
    }

    //----------------------------------------------------------------//
    formatServiceURL ( base, path, query, mostCurrent ) {

        const serviceURL        = url.parse ( base );
        serviceURL.pathname     = path;
        serviceURL.query        = _.cloneDeep ( query || {} );

        if ( mostCurrent !== true ) {
            serviceURL.query.at = this.height;
        }
        return url.format ( serviceURL );
    }

    //----------------------------------------------------------------//
    getServiceURL ( path, query, mostCurrent ) {

        const currentURLs = this.currentURLs;
        const serviceURL = currentURLs.length ? currentURLs [ Math.floor ( Math.random () * currentURLs.length )] : false;
        return serviceURL ? this.formatServiceURL ( serviceURL, path, query, mostCurrent ) : false;
    }

    //----------------------------------------------------------------//
    getServiceURLs ( path, query, mostCurrent ) {

        const urls = [];

        for ( let minerID of this.currentMiners ) {
            urls.push ( this.formatServiceURL ( miner.url, path, query, mostCurrent ));
        }
        return urls;
    }

    //----------------------------------------------------------------//
    async initializeWithNodeURLAsync ( nodeURL ) {

        this.reset ();

        try {

            const info = await this.revocable.fetchJSON ( nodeURL );

            if ( info && ( info.type === 'VOL_MINING_NODE' )) {

                if ( info.isMiner && info.minerID ) {

                    let accountInfo = await this.revocable.fetchJSON ( `${ nodeURL }accounts/${ info.minerID }` );
                    if ( accountInfo && accountInfo.miner ) {
                        nodeURL = accountInfo.miner.url;
                    }
                }

                this.load ({
                    identity:       info.identity,
                    genesis:        info.genesis,
                    height:         0,
                    digest:         info.genesis,
                    minerURLs:      [],
                    nodeURL:        nodeURL,
                });

                await this.discoverMinersSinglePassAsync ();
                if ( !this.onlineMiners.length ) return 'Problem getting miners.';
            }
            else {
                return 'Not a mining node.';
            }
        }
        catch ( error ) {
            console.log ( error );
            runInAction (() => {
                return 'Problem reaching URL; may be offline.';
            });
        }
    }

    //----------------------------------------------------------------//
    isIgnored ( minerID ) {
        
        return Boolean ( this.ignored [ minerID ]);
    }

    //----------------------------------------------------------------//
    @computed get
    isOnline () {

        const totalMiners = _.size ( this.minersByID );
        return totalMiners ? ( this.onlineMiners.length > Math.floor ( totalMiners / 2 )) : false;
    }

    //----------------------------------------------------------------//
    @action
    load ( store ) {

        this.identity       = store.identity;
        this.genesis        = store.genesis;
        this.height         = store.height;
        this.nextHeight     = store.nextHeight || store.height;
        this.digest         = store.digest;
        this.threshold      = !isNaN ( store.threshold ) ? store.threshold : DEFAULT_THRESHOLD;

        for ( let minerID of ( store.ignoredIDs || [] )) {
            this.toggleIgnored ( minerID );
        }

        const nodeURLs = store.minerURLs.concat ( store.nodeURL );
        this.affirmNodeURLs ( nodeURLs );
    }

    //----------------------------------------------------------------//
    @action
    reset () {

        this.error              = false;

        this.genesis            = false;
        this.identity           = '';
        this.height             = 0;
        this.nextHeight         = 0;

        this.digest             = false;
        this.isCurrent          = false;

        this.minersByID         = {};

        this.pendingURLs        = [];
        this.scannedURLs        = {};
    }

    //----------------------------------------------------------------//
    @action
    save ( store ) {

        store.height            = this.height;
        store.nextHeight        = this.nextHeight;
        store.digest            = this.digest;
        store.minerURLs         = this.onlineURLs;
        store.ignoredIDs        = this.ignoredIDs;
        store.threshold         = this.threshold;
    }

    //----------------------------------------------------------------//
    async serviceStepAsync () {

        await this.discoverMinersAsync ();
        this.updateConsensus ();
    }

    //----------------------------------------------------------------//
    @action
    setMinerOffline ( minerID ) {

        const miner             = this.minersByID [ minerID ];
        miner.online            = false;
    }

    //----------------------------------------------------------------//
    @action
    setThreshold ( threshold ) {

        this.threshold = threshold;
    }

    //----------------------------------------------------------------//
    @action
    setServiceCountdown ( countdown ) {

        this.serviceCountdown = countdown;
    }

    //----------------------------------------------------------------//
    async startServiceLoopAsync ( onStep ) {

        this.serviceLoopAsync ( onStep );
    }

    //----------------------------------------------------------------//
    async serviceLoopAsync ( onStep ) {

        if ( this.serviceCountdownTimeout ) {
            this.revocable.revoke ( this.serviceCountdownTimeout );
            this.serviceCountdownTimeout = false;
        }

        this.setServiceCountdown ( 0 );

        let count = this.serviceLoopCount || 0;
        debugLog ( 'SERVICE LOOP RUN:', count );
        this.serviceLoopCount = count + 1;

        await this.serviceStepAsync ();
        onStep && onStep ();

        const timeout = 5000;

        this.setServiceCountdown ( 1 );
        const delay = Math.floor ( timeout / 100 );
        let i = 0;
        const countdown = () => {
            if ( i++ < 100 ) {
                this.setServiceCountdown ( 1.0 - ( i / 100 ));
                this.serviceCountdownTimeout = this.revocable.timeout (() => { countdown ()}, delay );
            }
        }
        countdown ();

        this.revocable.timeout (() => { this.serviceLoopAsync ()}, timeout );
    }

    //----------------------------------------------------------------//
    @action
    toggleIgnored ( minerID ) {
        this.ignored [ minerID ] = !this.isIgnored ( minerID );
    }

    //----------------------------------------------------------------//
    @action
    updateConsensus () {

        this.findConsensus ();

        const half = Math.floor ( this.onlineMiners.length / 2 );

        const cluster = [];
        for ( let miner of this.onlineMiners ) {
        
            // count all miners *more* than 10 blocks higher than this miner
            let count = 0;
            for ( let other of this.onlineMiners ) {
                count += ( other.minerID !== miner.minerID ) && (( other.total - miner.total ) > 10 ) ? 1 : 0;
            }
            if ( half < count ) continue;
            cluster.push ( miner );
        }

        if ( cluster.length === 0 ) return;

        let nextHeight = cluster [ 0 ].total;
        for ( let miner of cluster ) {
            nextHeight = ( miner.total < nextHeight ) ? miner.total : nextHeight;
        }
        nextHeight = nextHeight - 1;

        if ( nextHeight > this.nextHeight ) {
            for ( let miner of cluster ) {
                miner.nextHeight    = nextHeight;
                miner.nextDigest    = false;
            }
            this.nextHeight = nextHeight;
        }
    }

    //----------------------------------------------------------------//
    @action
    async updateMinerAsync ( minerID ) {

        const miner = this.minersByID [ minerID ];

        try {

            let latency = ( new Date ()).getTime ();

            let minerURL = url.parse ( miner.url );
            minerURL.pathname = `/`;
            minerURL = url.format ( minerURL );

            // TODO: get this from peek info, so we only have to do one call
            const nodeInfo = await this.revocable.fetchJSON ( minerURL );
            if ( !( nodeInfo && nodeInfo.minerID ) || ( nodeInfo.genesis !== this.genesis )) {
                this.setMinerOffline ( miner.minerID );
                return;
            }

            runInAction (() => {
                miner.url               = minerURL;
                miner.total             = nodeInfo.totalBlocks;
                miner.online            = true;
                miner.build             = nodeInfo.build;
                miner.commit            = nodeInfo.commit;
                miner.acceptedRelease   = nodeInfo.acceptedRelease || 0;
                miner.nextRelease       = nodeInfo.nextRelease || 0;

                miner.height            = miner.height < miner.total ? miner.height : miner.total - 1;
                miner.nextHeight        = miner.nextHeight < miner.total ? miner.nextHeight : miner.total - 1;
            });

            const height            = miner.height;
            const nextHeight        = miner.nextHeight;

            let peekURL             = url.parse ( miner.url );
            peekURL.pathname        = `/consensus/peek`;
            peekURL.query           = { prev: height, peek: nextHeight, sampleMiners : 16 };
            peekURL                 = url.format ( peekURL );
            
            const result = await this.revocable.fetchJSON ( peekURL );
            
            // these could change while waiting for the previous batch of results. ignore them if they did.
            if ( miner.height === height ) {
                runInAction (() => {
                    miner.digest = result.prev ? result.prev.digest : false;
                });
            }

            if ( miner.nextHeight === nextHeight ) {
                runInAction (() => {
                    miner.nextDigest = result.peek ? result.peek.digest : false;
                });
            }

            result.miners.push ( miner.url );
            this.affirmNodeURLs ( result.miners );

            latency = ( new Date ()).getTime () - latency;
            runInAction (() => {
                miner.latency = latency;
            });
        }
        catch ( error ) {
            debugLog ( error );
            this.setMinerOffline ( miner.minerID );
        }

        this.revocable.timeout (() => { this.updateMinerAsync ( minerID )}, 5000 );
    }
}

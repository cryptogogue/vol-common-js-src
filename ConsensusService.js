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
    @observable height;

    @observable digest;
    @observable step;
    @observable isCurrent;

    @observable minersByID;

    @observable pendingURLs     = [];
    @observable scannedURLs     = {};

    @observable ignored         = {};
    @observable timeout         = DEFAULT_TIMEOUT;
    @observable threshold       = DEFAULT_THRESHOLD;

    @computed get               currentMiners           () { return this.onlineMiners.filter (( miner ) => { return miner.digest === this.digest; }); }
    @computed get               currentURLs             () { return this.currentMiners.map (( miner ) => { return miner.url; }); }
    @computed get               ignoredMiners           () { return Object.keys ( this.minersByID ).filter (( minerID ) => { return this.ignored [ minerID ]; }); }
    @computed get               isBlocked               () { return (( this.onlineMiners.length > 0 ) && ( this.currentMiners.length === 0 )); }
    @computed get               onlineMiners            () { return Object.values ( this.minersByID ).filter (( miner ) => { return ( miner.online && miner.digest && !this.isIgnored ( miner.minerID )); }); }
    @computed get               onlineURLs              () { return this.onlineMiners.map (( miner ) => { return miner.url; }); }

    //----------------------------------------------------------------//
    @action
    async acceptDigest ( digest, height ) {

        console.log ( `@CONSENSUS_CONTROL: ACCEPT: ${ this.height } --> ${ height }` );

        this.isCurrent = false;

        const minersByID = _.cloneDeep ( this.minersByID );

        for ( let minerID in minersByID ) {
            const miner = minersByID [ minerID ];
            if ( miner.nextDigest === digest ) {
                miner.height    = height;
                miner.digest    = digest;
            }
        }

        this.minersByID     = minersByID;
        this.height         = height;
        this.digest         = digest;
    }

    //----------------------------------------------------------------//
    @action
    async affirmMiner ( minerID, nodeURL ) {

        const miner = this.minersByID [ minerID ] || {};

        if ( miner.url ) {
            miner.url = nodeURL;
            return;
        }

        debugLog ( 'AFFIRMING MINER', minerID, nodeURL );

        miner.minerID           = minerID;
        miner.height            = 0;
        miner.digest            = false;        // digest at current consensus height (prev)
        miner.nextDigest        = false;        // digest at next consensus height (peek)
        miner.url               = nodeURL;
        miner.isBusy            = false;
        miner.online            = true;         // assume miner is online until proven otherwise
        miner.latency           = 0;

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

        debugLog ( 'DISCOVER MINERS ASYNC' );

        while ( this.pendingURLs.length > 0 ) {
            await this.discoverMinersSinglePassAsync ();
        }
    }

    //----------------------------------------------------------------//
    @action
    async discoverMinersSinglePassAsync () {

        debugLog ( 'DISCOVER MINERS ASYNC' );

        const checkMiner = async ( nodeURL, isPrimary ) => {

            debugLog ( 'CHECKING:', nodeURL );

            try {

                const confirmURL            = url.parse ( nodeURL );
                confirmURL.pathname         = `/`;

                let result = await this.revocable.fetchJSON ( url.format ( confirmURL ));

                if ( result.minerID ) {

                    debugLog ( 'FOUND A MINER:', nodeURL );
                    if ( result.genesis === this.genesis ) {
                        this.affirmMiner ( result.minerID, nodeURL, result.genesis );
                        this.setMinerBuildInfo ( result.minerID, result.build, result.commit, result.acceptedRelease, result.nextRelease );
                    }
                
                    confirmURL.pathname = `/miners`;
                    result = await this.revocable.fetchJSON ( url.format ( confirmURL ));

                    if ( result.miners ) {
                        for ( let minerURL of result.miners ) {
                            this.affirmNodeURLs ( minerURL );
                        }
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
                promises.push ( checkMiner ( nodeURL, nodeURL = this.nodeURL ));
            }
            this.pendingURLs = [];
        });
        await this.revocable.all ( promises );
    }

    //----------------------------------------------------------------//
    static findConsensus ( miners ) {

        console.log ( '@CONSENSUS_CONTROL: FIND CONSENSUS' );

        const minerCount = miners.length;
        if ( !minerCount ) {
            console.log ( '@CONSENSUS_CONTROL: NO MINERS?' );
            return [ false, 0 ]; // no online miners
        }

        let bestCount = 0;
        let bestDigest = false;

        // build a histogram of digests at next height; also get the rollback count
        const histogram = {}; // counts by digest
        for ( let miner of miners ) {
            if ( !miner.nextDigest ) continue;

            const count = ( histogram [ miner.nextDigest ] || 0 ) + 1;
            histogram [ miner.nextDigest ] = count;

            if ( bestCount < count ) {
                bestCount   = count;
                bestDigest  = miner.nextDigest;
            }
            console.log ( `@CONSENSUS_CONTROL: ${ miner.minerID } NEXT DIGEST: ${ miner.nextDigest }` );
        }

        const consensusRatio = bestCount / minerCount;

        console.log ( `@CONSENSUS_CONTROL: BEST DIGEST: ${ bestDigest } CONSENSUS RATIO: ${ consensusRatio }` );

        return [ bestDigest, consensusRatio ];
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
                    timeout:        DEFAULT_TIMEOUT,
                    minerURLs:      [],
                    nodeURL:        nodeURL,
                });

                await this.discoverMinersSinglePassAsync ();
                await this.updateMinersAsync ();

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

        this.identity   = store.identity;
        this.genesis    = store.genesis;
        this.height     = store.height;
        this.digest     = store.digest;
        this.timeout    = !isNaN ( store.longTimehout ) ? store.longTimehout : DEFAULT_TIMEOUT;
        this.threshold  = !isNaN ( store.threshold ) ? store.threshold : DEFAULT_THRESHOLD;

        if ( store.ignored ) {
            for ( let minerID of store.ignored ) {
                this.toggleIgnored ( minerID );
            }
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

        this.digest             = false;
        this.step               = 0;
        this.skip               = false;
        this.isCurrent          = false;

        this.minersByID         = {};

        this.pendingURLs        = [];
        this.scannedURLs        = {};
    }

    //----------------------------------------------------------------//
    @action
    save ( store ) {

        delete ( store.timeout );

        store.height            = this.height;
        store.digest            = this.digest;
        store.minerURLs         = this.onlineURLs;
        store.ignored           = this.ignoredMiners;
        store.longTimehout      = this.timeout;
        store.threshold         = this.threshold;
    }

    //----------------------------------------------------------------//
    async serviceStepAsync () {

        await this.discoverMinersAsync ();
        await this.updateMinersAsync ();

        if ( this.onlineMiners.length ) {
            await this.updateConsensus ();
        }
    }

    //----------------------------------------------------------------//
    @action
    setMinerBuildInfo ( minerID, build, commit, acceptedRelease, nextRelease ) {

        const miner             = this.minersByID [ minerID ];

        miner.build             = build;
        miner.commit            = commit;
        miner.acceptedRelease   = acceptedRelease || 0;
        miner.nextRelease       = nextRelease || 0;
    }

    //----------------------------------------------------------------//
    @action
    setMinerOffline ( minerID ) {

        const miner             = this.minersByID [ minerID ];

        debugLog ( 'UPDATE MINER OFFLINE', minerID, );

        miner.isBusy            = false;
        miner.online            = false;
    }

    //----------------------------------------------------------------//
    @action
    setMinerStatus ( minerID, url, total, prev, peek, latency ) {

        const miner             = this.minersByID [ minerID ];

        miner.minerID           = minerID;
        miner.digest            = prev ? prev.digest : false;
        miner.nextDigest        = peek ? peek.digest : false;
        miner.url               = url;
        miner.total             = total;
        miner.isBusy            = false;
        miner.online            = true;
        miner.latency           = ( miner.latency * (( LATENCY_SAMPLE_SIZE - 1 ) / LATENCY_SAMPLE_SIZE )) + ( latency / LATENCY_SAMPLE_SIZE );
    }

    //----------------------------------------------------------------//
    @action
    setThreshold ( threshold ) {

        this.threshold = threshold;
    }

    //----------------------------------------------------------------//
    @action
    setTimeout ( timeout ) {

        this.timeout = timeout;
    }

    //----------------------------------------------------------------//
    @action
    toggleIgnored ( minerID ) {

        this.ignored [ minerID ] = !this.isIgnored ( minerID );
    }

    //----------------------------------------------------------------//
    @action
    updateConsensus () {

        console.log ( '@CONSENSUS_CONTROL: UPDATE CONSENSUS' );

        // if not a single online miner matches our current digest, we're blocked
        if ( this.isBlocked ) return;

        const [ bestDigest, consensusRatio ] = ConsensusService.findConsensus ( this.currentMiners );

        const nextHeight = this.height + this.step;
        console.log ( `@CONSENSUS_CONTROL: CONSENSUS RATIO: ${ consensusRatio } AT: ${ nextHeight }` );

        if ( this.skip ) {

            if ( this.skip === consensusRatio ) {
                this.acceptDigest ( bestDigest, nextHeight );
                console.log ( `@CONSENSUS_CONTROL: SKIPPED: ${ this.height } --> ${ nextHeight }` );
                this.isCurrent = false;
            }
            else {
                this.isCurrent = true;
            }

            this.step = 1;
            this.skip = false;
        }
        else {

            this.skip = false;

            if (( this.threshold === 1.0 && consensusRatio === 1.0 ) || ( this.threshold < consensusRatio )) {

                this.acceptDigest ( bestDigest, nextHeight );
                this.step = this.step > 0 ? this.step * 2 : 1;

                console.log ( '@CONSENSUS_CONTROL: SPEED UP:', this.step );
            }
            else if (( this.step === 1 ) && ( consensusRatio > 0.5 )) {

                this.isCurrent      = false;
                this.checkCurrent   = false;

                this.step = 10;
                this.skip = consensusRatio;

                console.log ( '@CONSENSUS_CONTROL: SKIP:', this.step );
            }
            else {

                this.isCurrent = ( this.step === 1 );

                this.step = this.step > 1 ? this.step / 2 : 1;

                console.log ( '@CONSENSUS_CONTROL: SLOW DOWN:', this.step );
            }
        }   
    }

    //----------------------------------------------------------------//
    @action
    async updateMinersAsync () {

        debugLog ( 'SYNC: MINERS: SCAN MINERS' );

        const nextHeight = this.height + this.step;

        if ( _.size ( this.minersByID ) === 0 ) {
            debugLog ( 'SYNC: No miners found.' );
            return 5000;
        }

        const peek = async ( miner ) => {

            runInAction (() => {
                miner.isBusy = true;
            })

            try {

                debugLog ( 'TIMEOUT:', this.timeout );

                // TODO: get this from peek info, so we only have to do one call
                const nodeInfo = await this.revocable.fetchJSON ( url.format ( miner.url ), undefined, this.timeout );
                if ( !( nodeInfo && nodeInfo.minerID ) || ( nodeInfo.genesis !== this.genesis )) {
                    debugLog ( 'NOT A MINER OR MINER IS OFFLINE:', nodeInfo );
                    this.setMinerOffline ( miner.minerID );
                    return;
                }

                this.setMinerBuildInfo ( miner.minerID, nodeInfo.build, nodeInfo.commit, nodeInfo.acceptedRelease, nodeInfo.nextRelease );

                // "peek" at the headers of the current and next block; also get a random sample of up to 16 miners.
                let peekURL         = url.parse ( miner.url );
                peekURL.pathname    = `/consensus/peek`;
                peekURL.query       = { peek: nextHeight, prev: this.height, sampleMiners : 16 };
                peekURL             = url.format ( peekURL );

                debugLog ( 'SYNC: PEEK:', peekURL );

                let latency = ( new Date ()).getTime ();
                const result = await this.revocable.fetchJSON ( peekURL, undefined, this.timeout );
                latency = ( new Date ()).getTime () - latency;

                debugLog ( 'SYNC: PEEK RESULT:', result );

                result.miners.push ( miner.url );
                this.affirmNodeURLs ( result.miners );
                this.setMinerStatus ( result.minerID, miner.url, result.totalBlocks, result.prev, result.peek, latency );
            }
            catch ( error ) {
                debugLog ( 'SYNC: MINERS:', error );
                this.setMinerOffline ( miner.minerID );
            }
        }

        const promises = [];
        for ( let minerID in this.minersByID ) {
            const miner = this.minersByID [ minerID ];
            if ( miner.isBusy ) continue;
            if ( this.isIgnored ( minerID )) continue;

            promises.push ( peek ( miner ));
        }

        await this.revocable.all ( promises );

        debugLog ( 'SYNC: UPDATED MINERS:', JSON.stringify ( this.minersByID, null, 4 ));
    }   
}

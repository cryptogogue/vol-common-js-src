// Copyright (c) 2020 Cryptogogue, Inc. All Rights Reserved.

import { Transaction, TRANSACTION_TYPE }        from './Transaction';
import { util }                                 from 'fgc';
import { action, computed, observable, toJS }   from 'mobx';

//const debugLog = function () {}
const debugLog = function ( ...args ) { console.log ( '@TX:', ...args ); }

const TX_MINER_TIMEOUT = 10000;

export const TX_STATUS = {

    // STAGED
    STAGED:             'STAGED',

    // PENDING
    PENDING:            'PENDING',
    SENDING:            'SENDING',
    MIXED:              'MIXED',

    // STOPPED
    REJECTED:           'REJECTED',
    BLOCKED:            'BLOCKED',

    // ACCEPTED
    ACCEPTED:           'ACCEPTED',
    RESTORED:           'RESTORED',
    LOST:               'LOST',
};

export const TX_QUEUE_STATUS = {

    ACCEPTED:           'ACCEPTED',
    BLOCKED:            'BLOCKED',
    LOST:               'LOST',
    PENDING:            'PENDING',
    STAGED:             'STAGED',
};

export const TX_MINER_STATUS = {
    NEW:                'NEW',
    ACCEPTED:           'ACCEPTED',
    REJECTED:           'REJECTED',
    TIMED_OUT:          'TIMED_OUT',
};

//================================================================//
// TransactionQueueEntry
//================================================================//
export class TransactionQueueEntry {

    @observable status                  = TX_STATUS.STAGED;
    @observable accountName             = '';
    @observable assetsFiltered          = {};
    @observable cost                    = 0;
    @observable envelope                = false;
    @observable uuid                    = '';
    @observable type                    = '';
    @observable nonce                   = -1;
    @observable offerID                 = false;

    @observable submitCount             = 0;
    @observable minerStatus             = {};
    @observable minerBusy               = {};
    @observable rejection               = false;

    @computed get friendlyName          () { return Transaction.friendlyNameForType ( this.type ); }
    @computed get isAccepted            () { return ( this.queueStatus === TX_QUEUE_STATUS.ACCEPTED ); }
    @computed get isBlocked             () { return ( this.queueStatus === TX_QUEUE_STATUS.BLOCKED ); }
    @computed get isLost                () { return ( this.queueStatus === TX_QUEUE_STATUS.LOST ); }
    @computed get isPending             () { return ( this.queueStatus === TX_QUEUE_STATUS.PENDING ); }
    @computed get isStaged              () { return ( this.queueStatus === TX_QUEUE_STATUS.STAGED ); }
    @computed get isUnsent              () { return !(( this.queueStatus === TX_QUEUE_STATUS.ACCEPTED ) || ( this.queueStatus === TX_QUEUE_STATUS.PENDING ) || ( this.queueStatus === TX_QUEUE_STATUS.LOST )); }
    @computed get queueStatus           () { return this.getQueueStatus (); }

    @computed get acceptingMiners       () { return Object.keys ( this.minerStatus ).filter (( minerID ) => { return this.minerStatus [ minerID ] === TX_MINER_STATUS.ACCEPTED; }); }
    @computed get rejectingMiners       () { return Object.keys ( this.minerStatus ).filter (( minerID ) => { return this.minerStatus [ minerID ] === TX_MINER_STATUS.REJECTED; }); }
    @computed get respondingMiners      () { return Object.keys ( this.minerStatus ).filter (( minerID ) => { return this.minerStatus [ minerID ] !== TX_MINER_STATUS.TIMED_OUT; }); }

    //----------------------------------------------------------------//
    @action
    affirmMiner ( minerID ) {

        if ( !_.has ( this.minerStatus, minerID )) {
            this.minerStatus [ minerID ] = TX_MINER_STATUS.NEW;
        }
    }

    //----------------------------------------------------------------//
    @action
    clearMiners () {

        this.minerStatus        = {};
        this.minerBusy          = {};
        this.rejection          = false;
        this.submitCount        = this.submitCount + 1;
    }

    //----------------------------------------------------------------//
    constructor ( uuid, type, envelope ) {

        this.uuid               = uuid;
        this.type               = type;
        this.envelope           = envelope || false;
    }

    //----------------------------------------------------------------//
    @action
    static fromTransaction ( transaction ) {

        const self              = new TransactionQueueEntry ( transaction.uuid, transaction.type );

        self.accountName        = transaction.body.maker ? transaction.body.maker.accountName : false;
        self.assetsFiltered     = _.cloneDeep ( transaction.assetsFiltered );
        self.offerID            = transaction.offerID || false;
        self.cost               = transaction.cost;

        return self;
    }

    //----------------------------------------------------------------//
    @action
    static fromTransactionHistoryEntry ( historyEntry ) {

        const self              = new TransactionQueueEntry ( historyEntry.uuid, historyEntry.type );

        self.accountName        = historyEntry.accountName;
        self.cost               = historyEntry.cost;
        self.nonce              = historyEntry.nonce;
        self.status             = TX_STATUS.RESTORED;

        return self;
    }

    //----------------------------------------------------------------//
    getMinerBusy ( minerID ) {

        return this.minerBusy [ minerID ] || false;
    }

    //----------------------------------------------------------------//
    getMinerStatus ( minerID ) {

        return this.minerStatus [ minerID ] || false;
    }

    //----------------------------------------------------------------//
    getQueueStatus () {

        switch ( this.status ) {

            // STAGED
            case TX_STATUS.STAGED:    // isUnsent
                return TX_QUEUE_STATUS.STAGED;

            // PENDING
            case TX_STATUS.PENDING:
            case TX_STATUS.SENDING:
            case TX_STATUS.MIXED:
                return TX_QUEUE_STATUS.PENDING;

            // BLOCKED
            case TX_STATUS.REJECTED:  // isUnsent
            case TX_STATUS.BLOCKED:   // isUnsent
                return TX_QUEUE_STATUS.BLOCKED;

            // ACCEPTED
            case TX_STATUS.ACCEPTED:
            case TX_STATUS.RESTORED:
                return TX_QUEUE_STATUS.ACCEPTED;

            // LOST
            case TX_STATUS.LOST:      // isUnsent
                return TX_QUEUE_STATUS.LOST;
        }
        throw ( new Error ( 'Unknown transaction status; could not resolve getQueueStatus ().' ))
    }

    //----------------------------------------------------------------//
    @action
    static load ( object ) {

        const self              = new TransactionQueueEntry ();

        self.status             = object.status;
        self.accountName        = object.accountName;
        self.assetsFiltered     = object.assetsFiltered || {};
        self.offerID            = object.offerID || false;
        self.cost               = object.cost;
        self.acceptedCount      = object.acceptedCount;
        self.uuid               = object.uuid;
        self.type               = object.type;
        self.nonce              = object.nonce;

        self.minerStatus        = object.minerStatus || {};
        self.rejection          = object.rejection || false;
        self.submitCount        = object.submitCount || 0;

        self.envelope           = object.envelope;

        return self;
    }

    //----------------------------------------------------------------//
    @action
    async processAsync ( consensusService, getEnvelopeAsync, onError ) {

        if ( !consensusService.isOnline ) return;
        if ( !this.isPending ) return;

        if ( this.status === TX_STATUS.PENDING ) {
            this.setStatus ( TX_STATUS.SENDING );
        }

        let envelope = this.envelope || false;
        const lazyLoadEnvelopeAsync = async () => {
            envelope = envelope || await getEnvelopeAsync ( this.uuid );
            return envelope;
        }

        // send transaction to all online miners
        const miners = consensusService.onlineMiners;
        for ( let miner of miners ) {
            this.processMinerAsync ( consensusService, miner, lazyLoadEnvelopeAsync );
        }

        const responseCount = this.respondingMiners.length;
        const rejectCount   = this.rejectingMiners.length;

        // if we got any responses, do something
        if ( responseCount ) {

            // if there were rejections, do something
            if ( rejectCount ) {

                if ( rejectCount === responseCount ) {

                    const rejection = this.rejection;
                    this.setStatus ( TX_STATUS.REJECTED );
                    onError ( rejection.uuid, rejection.message );
                }
                else {
                    this.setStatus ( TX_STATUS.MIXED );
                }
            }
            else {
                this.setStatus ( TX_STATUS.SENDING );
            }
        }
    }

    //----------------------------------------------------------------//
    @action
    async processMinerAsync ( consensusService, miner, loadEnvelopeAsync ) {

        const minerID       = miner.minerID;
        const minerURL      = miner.url;

        debugLog ( 'process miner', minerID, minerURL );

        this.affirmMiner ( minerID );

        if ( this.getMinerStatus ( minerID ) === TX_MINER_STATUS.REJECTED ) return;
        if ( this.getMinerBusy ( minerID )) return;

        const submitCount = this.submitCount;
        this.setMinerBusy ( minerID, true );

        const serviceURL = consensusService.formatServiceURL ( minerURL, this.accountName  ? `/accounts/${ this.accountName }/transactions/${ this.uuid }` : `/transactions/${ this.uuid }` );

        debugLog ( 'SERVICE URL:', serviceURL );

        const putTransactionAsync = async () => {

            debugLog ( 'submitting transaction', minerID, this.uuid );

            // re-send the transaction if not recognized.
            const envelope = await loadEnvelopeAsync ();
            const result = await consensusService.revocable.fetchJSON ( serviceURL, {
                method :    'PUT',
                headers :   { 'content-type': 'application/json' },
                body :      JSON.stringify ( envelope, null, 4 ),
            }, TX_MINER_TIMEOUT );

            if ( this.submitCount !== submitCount ) return;

            if ( result && ( result.status === 'OK' )) {
                this.setMinerStatus ( minerID, TX_MINER_STATUS.ACCEPTED );
            }
        }

        try {
            
            if ( this.getMinerStatus ( minerID ) === TX_MINER_STATUS.NEW ) {
                await putTransactionAsync ();
            }
            else {

                debugLog ( 'checking transaction', minerID, this.uuid );
                const response = await consensusService.revocable.fetchJSON ( serviceURL, undefined, TX_MINER_TIMEOUT );
                if ( this.submitCount !== submitCount ) return;

                debugLog ( 'RESPONSE:', response );

                switch ( response.status ) {

                    case 'ACCEPTED':
                        
                        this.setMinerStatus ( minerID, TX_MINER_STATUS.ACCEPTED );
                        break;

                    case 'REJECTED':
                    case 'IGNORED':
                        
                        if ( response.uuid === this.uuid ) {
                            this.setMinerStatus ( minerID, TX_MINER_STATUS.REJECTED );
                            this.setRejection ( response );
                        }
                        break;

                    case 'UNKNOWN': {

                        // re-submit
                        await putTransactionAsync ();
                        break;
                    }
                }
            }
        }
        catch ( error ) {
            debugLog ( error );
            if ( this.submitCount !== submitCount ) return;
            if ( this.getMinerStatus ( minerID ) === TX_MINER_STATUS.NEW ) { 
                this.setMinerStatus ( minerID, TX_MINER_STATUS.TIMED_OUT );
            }
        }

        this.setMinerBusy ( minerID, false );
    }

    //----------------------------------------------------------------//
    @action
    setMinerBusy ( minerID, busy ) {

        this.minerBusy [ minerID ] = busy;
    }

    //----------------------------------------------------------------//
    @action
    setMinerStatus ( minerID, status ) {

        this.minerStatus [ minerID ] = status;
    }

    //----------------------------------------------------------------//
    @action
    setNonce ( nonce ) {

        this.nonce = nonce;
    }

    //----------------------------------------------------------------//
    @action
    setRejection ( rejection ) {

        this.rejection = rejection;
    }

    //----------------------------------------------------------------//
    @action
    setStatus ( status ) {

        this.status = status;
    }

    //----------------------------------------------------------------//
    @action
    submitWithNonce ( nonce ) {

        this.clearMiners ();
        this.status  = TX_STATUS.PENDING;
        this.nonce   = nonce;
    }
};

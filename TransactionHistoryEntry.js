// Copyright (c) 2020 Cryptogogue, Inc. All Rights Reserved.

import * as util                            from './util';
import { Transaction, TRANSACTION_TYPE }    from './Transaction';
import { action, computed, observable }     from 'mobx';

//const debugLog = function () {}
const debugLog = function ( ...args ) { console.log ( '@TX:', ...args ); }

//================================================================//
// TransactionHistoryEntry
//================================================================//
export class TransactionHistoryEntry {

    @observable time                    = '';

    @observable blockHeight             = -1;
    @observable makerIndex              = -1;
    @observable isMaker                 = false;
    @observable details                 = {};

    @observable accountName             = '';
    @observable cost                    = 0;
    @observable uuid                    = '';
    @observable type                    = '';
    @observable nonce                   = -1;

    @computed get friendlyName          () { return Transaction.friendlyNameForType ( this.type ); }

    //----------------------------------------------------------------//
    constructor () {
    }

    //----------------------------------------------------------------//
    @computed get
    explanation () {    
        
        const formatAssetIDs = ( assetIDs ) => {
            if ( assetIDs === false ) return '[unknown assets]';
            if ( !assetIDs.length ) return 'no assets';
            if ( assetIDs.length === 1 ) return `an asset (${ assetIDs [ 0 ] })`;
            return `${ assetIDs.length } assets (${ assetIDs.join ( ', ' )})`;
        }

        const isMaker   = this.isMaker;
        const details   = this.details;

        const assetIDs  = this.details.assetIDs ? formatAssetIDs ( this.details.assetIDs ) : '';

        switch ( this.type ) {

            case TRANSACTION_TYPE.BUY_ASSETS: {

                if ( isMaker ) return `You bought ${ assetIDs } from ${ details.seller }.`;
                return `${ details.buyer } bought ${ assetIDs } from you.`;
            }

            case TRANSACTION_TYPE.PUBLISH_SCHEMA:
            case TRANSACTION_TYPE.PUBLISH_SCHEMA_AND_RESET: {

                const version = details.version;

                return `You published '${ version.release } - ${ version.major }.${ version.minor }.${ version.revision }'.`;
            }

            case TRANSACTION_TYPE.SEND_ASSETS: {
                if ( isMaker ) return `You sent ${ assetIDs } to ${ details.to }.`;
                return `${ details.from } sent you ${ assetIDs }.`;
            }

            case TRANSACTION_TYPE.SEND_VOL: {

                const amount = util.format ( details.amount );

                if ( isMaker ) return `You sent ${ details.to } ${ amount } VOL.`;
                return `${ details.from } sent you ${ amount } VOL.`;
            }
        }
        return '--';
    }

    //----------------------------------------------------------------//
    @action
    static fromAccountLogEntry ( accountIndex, entry ) {

        const envelope          = entry.transaction;
        const transaction       = Transaction.fromBody ( JSON.parse ( envelope.body ));

        const self              = new TransactionHistoryEntry ();

        self.time               = entry.time;
        self.blockHeight        = entry.blockHeight;
        self.makerIndex         = envelope.makerIndex;
        self.isMaker            = accountIndex === envelope.makerIndex;

        self.accountName        = transaction.body.maker.accountName;
        self.cost               = transaction.cost;
        self.uuid               = transaction.uuid;
        self.type               = transaction.type;
        self.nonce              = transaction.body.maker.nonce;

        self.setDetails ( accountIndex, transaction.body, envelope.details );

        return self;
    }

    //----------------------------------------------------------------//
    @action
    static load ( object ) {

        const self              = new TransactionHistoryEntry ();

        self.time               = object.time;
        self.blockHeight        = object.blockHeight;
        self.makerIndex         = object.makerIndex;
        self.isMaker            = object.isMaker;

        self.accountName        = object.accountName;
        self.cost               = object.cost;
        self.uuid               = object.uuid;
        self.type               = object.type;
        self.nonce              = object.nonce;

        self.details            = object.details;

        return self;
    }

    //----------------------------------------------------------------//
    setDetails ( accountIndex, body, details ) {    
        
        details = details || {};
        this.details = {};

        const assetIDs = details.assets ? details.assets.map (( asset ) => { return asset.assetID; }) : false;

        switch ( body.type ) {

            case TRANSACTION_TYPE.BUY_ASSETS: {

                this.details.assetIDs   = assetIDs;
                this.details.seller     = details.from;
                this.details.buyer      = details.to;
                break;
            }

            case TRANSACTION_TYPE.PUBLISH_SCHEMA:
            case TRANSACTION_TYPE.PUBLISH_SCHEMA_AND_RESET: {

                this.details.version    = body.schema.version;
                break;
            }

            case TRANSACTION_TYPE.SEND_ASSETS: {

                this.details.assetIDs   = assetIDs;
                this.details.from       = details.from;
                this.details.to         = details.to;
                break;
            }

            case TRANSACTION_TYPE.SEND_VOL: {

                this.details.amount     = ( body.amount );
                this.details.from       = body.maker.accountName
                this.details.to         = body.accountName;
                break;
            }
        }
    }
};

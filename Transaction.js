// Copyright (c) 2020 Cryptogogue, Inc. All Rights Reserved.

import *as util                             from './util';
import * as fgc                             from 'fgc';
import { action, computed, observable }     from 'mobx';

//const debugLog = function () {}
const debugLog = function ( ...args ) { console.log ( '@TX:', ...args ); }

export const TRANSACTION_TYPE = {
    ACCOUNT_POLICY:             'ACCOUNT_POLICY',
    AFFIRM_KEY:                 'AFFIRM_KEY',
    BETA_GET_ASSETS:            'BETA_GET_ASSETS',
    BETA_GET_DECK:              'BETA_GET_DECK',
    BUY_ASSETS:                 'BUY_ASSETS',
    CANCEL_OFFER:               'CANCEL_OFFER',
    HARD_RESET:                 'HARD_RESET',
    IDENTIFY_ACCOUNT:           'IDENTIFY_ACCOUNT',
    KEY_POLICY:                 'KEY_POLICY',
    NEW_ACCOUNT:                'NEW_ACCOUNT',
    OPEN_ACCOUNT:               'OPEN_ACCOUNT',
    OFFER_ASSETS:               'OFFER_ASSETS',
    PUBLISH_SCHEMA:             'PUBLISH_SCHEMA',
    PUBLISH_SCHEMA_AND_RESET:   'PUBLISH_SCHEMA_AND_RESET',
    REGISTER_MINER:             'REGISTER_MINER',
    RENAME_ACCOUNT:             'RENAME_ACCOUNT',
    RESERVE_ACCOUNT_NAME:       'RESERVE_ACCOUNT_NAME',
    RUN_SCRIPT:                 'RUN_SCRIPT',
    SELECT_REWARD:              'SELECT_REWARD',
    SEND_ASSETS:                'SEND_ASSETS',
    SEND_VOL:                   'SEND_VOL',
    STAMP_ASSETS:               'STAMP_ASSETS',
    SET_IDENTITY_PROVIDER:      'SET_IDENTITY_PROVIDER',
    SET_MINIMUM_GRATUITY:       'SET_MINIMUM_GRATUITY',
    SET_TERMS_OF_SERVICE:       'SET_TERMS_OF_SERVICE',
    UPGRADE_ASSETS:             'UPGRADE_ASSETS',
    UPDATE_MINER_INFO:          'UPDATE_MINER_INFO',
};

//================================================================//
// Transaction
//================================================================//
export class Transaction {

    get accountID           () { return this.maker.accountName; }
    get cost                () { return ( this.body.maker.gratuity || 0 ) + ( this.body.maker.transferTax || 0 ) + this.vol; }
    get friendlyName        () { return Transaction.friendlyNameForType ( this.body.type ); }
    get maker               () { return this.body.maker; }
    get nonce               () { return this.maker.nonce; }
    get type                () { return this.body.type; }
    get uuid                () { return this.body.uuid || ''; }
    get vol                 () { return this.virtual_getSendVOL ? this.virtual_getSendVOL () : 0; }
    get weight              () { return this.virtual_getWeight ? this.virtual_getWeight () : 1; }

    //----------------------------------------------------------------//
    constructor ( body ) {

        this.assetsFiltered         = {};
        this.offerID                = false;
        this.body                   = body;
    }

    //----------------------------------------------------------------//
    static friendlyNameForType ( type ) {

        switch ( type ) {
            case TRANSACTION_TYPE.ACCOUNT_POLICY:               return 'Account Policy';
            case TRANSACTION_TYPE.AFFIRM_KEY:                   return 'Affirm Key';
            case TRANSACTION_TYPE.BETA_GET_DECK:                return 'BETA Get Deck';
            case TRANSACTION_TYPE.BETA_GET_ASSETS:              return 'BETA Get Assets';
            case TRANSACTION_TYPE.BUY_ASSETS:                   return 'Buy Assets';
            case TRANSACTION_TYPE.CANCEL_OFFER:                 return 'Cancel Offer';
            case TRANSACTION_TYPE.IDENTIFY_ACCOUNT:             return 'Identify Account';
            case TRANSACTION_TYPE.KEY_POLICY:                   return 'Key Policy';
            case TRANSACTION_TYPE.OFFER_ASSETS:                 return 'Sell Assets';
            case TRANSACTION_TYPE.OPEN_ACCOUNT:                 return 'Sponsor Account';
            case TRANSACTION_TYPE.PUBLISH_SCHEMA:               return 'Publish Schema';
            case TRANSACTION_TYPE.PUBLISH_SCHEMA_AND_RESET:     return 'Publish Schema and Reset';
            case TRANSACTION_TYPE.REGISTER_MINER:               return 'Register Miner';
            case TRANSACTION_TYPE.RENAME_ACCOUNT:               return 'Rename Account';
            case TRANSACTION_TYPE.RESERVE_ACCOUNT_NAME:         return 'Reserve Account Name';
            case TRANSACTION_TYPE.RUN_SCRIPT:                   return 'Run Script';
            case TRANSACTION_TYPE.SELECT_REWARD:                return 'Select Reward';
            case TRANSACTION_TYPE.SEND_ASSETS:                  return 'Send Assets';
            case TRANSACTION_TYPE.SEND_VOL:                     return 'Send VOL';
            case TRANSACTION_TYPE.STAMP_ASSETS:                 return 'Stamp Assets';
            case TRANSACTION_TYPE.SET_IDENTITY_PROVIDER:        return 'Set Identity Provider';
            case TRANSACTION_TYPE.SET_MINIMUM_GRATUITY:         return 'Set Minimum Gratuity';
            case TRANSACTION_TYPE.SET_TERMS_OF_SERVICE:         return 'Set Terms of Service';
            case TRANSACTION_TYPE.UPGRADE_ASSETS:               return 'Upgrade Assets';
            case TRANSACTION_TYPE.UPDATE_MINER_INFO:            return 'Update Miner Info';
        }
        return 'UNKNOWN';
    }

    //----------------------------------------------------------------//
    static fromBody ( body ) {

        switch ( body.type ) {
            case TRANSACTION_TYPE.BUY_ASSETS:       return new Transaction_BuyAssets ( body );
            case TRANSACTION_TYPE.OPEN_ACCOUNT:     return new Transaction_OpenAccount ( body );
            case TRANSACTION_TYPE.RUN_SCRIPT:       return new Transaction_RunScript ( body );
            case TRANSACTION_TYPE.SEND_VOL:         return new Transaction_SendVOL ( body );
            case TRANSACTION_TYPE.STAMP_ASSETS:     return new Transaction_StampAssets ( body );
            default:                                return new Transaction ( body );
        }
    }

    //----------------------------------------------------------------//
    @action
    static load ( transaction ) {

        return Transaction.fromBody ( transaction.body );
    }

    //----------------------------------------------------------------//
    @action
    setAssetsFiltered ( assetIDs, filterStatus ) {

        this.assetsFiltered = this.assetsFiltered || {};
        for ( let assetID of assetIDs ) {
            this.assetsFiltered [ assetID ] = filterStatus;
        }
    }

    //----------------------------------------------------------------//
    @action
    setOfferID ( offerID ) {

        this.offerID = offerID;
    }

    //----------------------------------------------------------------//
    @action
    setBody ( body ) {

        this.body = body;
    }

    //----------------------------------------------------------------//
    @action
    setFees ( feeSchedule ) {

        const maker         = this.body.maker;
        const fees          = util.calculateTransactionFees ( feeSchedule, this.type, maker.gratuity, this.vol );

        maker.profitShare   = fees.profitShare;
        maker.transferTax   = fees.transferTax;
    }

    //----------------------------------------------------------------//
    @action
    setUUID ( uuid ) {

        this.body.uuid = uuid || fgc.util.generateUUIDV4 ();
    }

    //----------------------------------------------------------------//
    @action
    setWeight ( weight ) {

        this.body.weight    = weight;
    }
};

//================================================================//
// Transaction_BuyAssets
//================================================================//
class Transaction_BuyAssets extends Transaction {

    //----------------------------------------------------------------//
    virtual_getSendVOL () {

        return this.body.price || 0;
    }
};

//================================================================//
// Transaction_OpenAccount
//================================================================//
class Transaction_OpenAccount extends Transaction {

    //----------------------------------------------------------------//
    virtual_getSendVOL () {

        return this.body.grant || 0;
    }
};

//================================================================//
// Transaction_RunScript
//================================================================//
class Transaction_RunScript extends Transaction {

    //----------------------------------------------------------------//
    virtual_getWeight () {

        return ( this.body.weight || 1 );
    }
};

//================================================================//
// Transaction_SendVOL
//================================================================//
class Transaction_SendVOL extends Transaction {

    //----------------------------------------------------------------//
    virtual_getSendVOL () {

        return this.body.amount || 0;
    }
};

//================================================================//
// Transaction_StampAssets
//================================================================//
class Transaction_StampAssets extends Transaction {

    //----------------------------------------------------------------//
    virtual_getSendVOL () {

        return this.body.price * this.body.assetIdentifiers.length;
    }
};


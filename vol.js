// Copyright (c) 2019 Cryptogogue, Inc. All Rights Reserved.

import crypto                           from 'crypto';
import _                                from 'lodash';

//----------------------------------------------------------------//
export function decodeAccountRequest ( encoded ) {

    console.log ( 'DECODE ACCOUNT REQUEST' );

    if ( encoded && encoded.length ) {
        try {

            encoded = encoded.replace ( /(\r\n|\n|\r )/gm, '' );
            console.log ( 'ENCODED:', encoded );

            const requestJSON = Buffer.from ( encoded, 'base64' ).toString ( 'utf8' );
            const request = JSON.parse ( requestJSON );

            return request;
        }
        catch ( error ) {
            console.log ( error );
        }
    }
    return false;
}

//----------------------------------------------------------------//
export function encodeAccountRequest ( genesis, publicKeyHex, signature ) {

    console.log ( 'ENCODE ACCOUNT REQUEST' );

    const request = {
        genesis:            genesis,
        key: {
            type:           'EC_HEX',
            groupName:      'secp256k1',
            publicKey:      publicKeyHex,
        },
    }

    if ( signature ) {
        request.signature = signature;
    }

    const requestJSON   = JSON.stringify ( request );
    const encoded       = Buffer.from ( requestJSON, 'utf8' ).toString ( 'base64' );

    console.log ( 'ENCODED:', encoded );

    return encoded;
}

//----------------------------------------------------------------//
export function makeAccountSuffix () {

    // TODO: replace with something deterministic
    const suffixPart = () => {
        return crypto.randomBytes ( 2 ).toString ( 'hex' ).substring ( 0, 3 );
    }
    return `${ suffixPart ()}.${ suffixPart ()}.${ suffixPart ()}`.toUpperCase ();
}

//----------------------------------------------------------------//
export function signTransaction ( key, body, nonce ) {

    const recordBy = new Date ();
    recordBy.setTime ( recordBy.getTime () + ( 8 * 60 * 60 * 1000 )); // yuck

    body = _.cloneDeep ( body );

    body.maxHeight      = 0; // don't use for now
    body.recordBy       = recordBy.toISOString ();
    body.maker.nonce    = nonce;

    const bodyStr = JSON.stringify ( body );

    let envelope = {
        body: bodyStr,
        signature: {
            hashAlgorithm:  'SHA256',
            // digest:         key.hash ( bodyStr ),
            signature:      key.sign ( bodyStr ),
        }
    };

    return envelope;
}

// Copyright (c) 2020 Cryptogogue, Inc. All Rights Reserved.

import _                    from 'lodash';

//----------------------------------------------------------------//
export function check ( entitlements, path, value ) {

    if ( !path ) return false;

    path = path.split ( '.' );
    for ( let i in path ) {
        const name = path [ i ];
        if ( !( entitlements.children && _.has ( entitlements.children, name ))) return false;
        entitlements = entitlements.children [ name ];
    }

    switch ( entitlements.type ) {
        
        case 'path':        return true;
        case 'boolean':     return entitlements.value;

        case 'numeric': {

            const lower = entitlements.lower || { enabled: false };
            const upper = entitlements.upper || { enabled: false };

            if ( typeof ( value ) === 'number' ) {

                if ( lower.enabled ) {
                    if ( lower.exclude && ( value === lower.limit )) return false;
                    if ( value < lower.limit ) return false;
                }

                if ( upper.enabled ) {
                    if ( upper.exclude && ( value === upper.limit )) return false;
                    if ( value > upper.limit ) return false;
                }

                return true;
            }
            return ( !( lower.enabled || upper.enabled ));
        }
    }
    return false;
}

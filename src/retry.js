var Step = require( "step" ),
	hook = require( "./hook" ),
	service = require( "./service" ),
	retry = require( "./retrydb" ),
	logger = require( "./logger" );

process.on( "uncaughtException", function( error ) {
	logger.error( "Uncaught exception: " + error.stack );
});

// exponential backoff for retries, with a max of 2 minutes
function wait( tries ) {
	return Math.min( 120, (Math.pow( 2, tries ) - 1) ) * 1000;
}

var actions = {};

actions.processVersions = function( repoId, fn ) {
	var repo = service.getRepoById( repoId );
	hook.processVersions( repo, fn );
};

actions.processRelease = function( repoId, tag, file, fn ) {
	var repo = service.getRepoById( repoId );
	repo.getPackageJson( tag, file, function( error, package ) {
		if ( error ) {
			return fn( error );
		}

		hook.processRelease( repo, tag, file, package, fn );
	});
};

actions.processMeta = function( repoId, fn ) {
	var repo = service.getRepoById( repoId );
	hook.processMeta( repo, fn );
};

function processFailures( fn ) {
	Step(
		function() {
			retry.getFailure( this );
		},

		function( error, failure ) {
			if ( error ) {
				return fn( error );
			}

			// no more failures, wait then try again
			if ( !failure ) {
				setTimeout(function() {
					processFailures( fn );
				}, 5000 );
				return;
			}

			// TODO: if failure count gets too high, email someone
			this.parallel()( null, failure );
			setTimeout( this.parallel(), wait( failure.tries ) );
		},

		function( error, failure ) {
			this.parallel()( null, failure );
			actions[ failure.method ].apply( null, failure.args.concat( this.parallel() ) );
		},

		function( error, failure ) {
			if ( error ) {
				return fn( error );
			}

			retry.remove( failure.retry, this );
		},

		function( error ) {
			if ( error ) {
				console.log( error.stack );
			}

			processFailures( fn );
		}
	);
}

processFailures(function( error ) {
	logger.error( "Error during retry: " + error.stack );
});

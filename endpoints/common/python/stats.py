'''Daily counters for the admin overview, for events nothing else records.

One item per UTC day, STATS#<yyyy-mm-dd> {downloads}, in the files table. Most
admin numbers are worked out from the records themselves (sign-ups from the
users, uploads from the files, shares from the links), but a download leaves
no record of its own, so it is counted here. Counting is best effort: a
failed counter update never fails the download.
'''

import datetime
import time

import log
import storage

PREFIX = 'STATS#'
KEEP_SECONDS = 400 * 86400   # a little over a year of history
LOGGER = log.setup_logging()


def day(epoch=None):
    moment = datetime.datetime.fromtimestamp(time.time() if epoch is None else epoch, tz=datetime.timezone.utc)
    return moment.strftime('%Y-%m-%d')


def bump(metric, amount=1):
    try:
        storage.table().update_item(
            Key={'file_id': PREFIX + day()},
            UpdateExpression='ADD #m :n SET #k = :kind, #t = if_not_exists(#t, :ttl)',
            ExpressionAttributeNames={'#m': metric, '#k': 'kind', '#t': 'ttl'},
            ExpressionAttributeValues={':n': int(amount), ':kind': 'stats',
                                       ':ttl': int(time.time()) + KEEP_SECONDS})
    except Exception:  # pylint: disable=broad-except
        LOGGER.exception('could not count %s', metric)

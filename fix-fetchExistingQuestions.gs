/* ============================================================
   REPLACE fetchExistingQuestions() WITH THIS
   ============================================================

   THE BUG

   The old version called:

       GET /api/questions

   with no page or limit. The backend defaults to
   limit = 20, sort = newest, so it returned only the
   20 most recently created questions:

       ids 38 - 57

   Your sheet claims 26 ids:

       29, 30, 33, 34, 35, 36   <- older, NOT on page 1
       38 ... 57                <- the 20 it did see

   So the script found 20 and reported the other 6 as
   "ID NOT FOUND", even though all 6 exist and return
   HTTP 200. That is exactly the

       Updated: 20    Failed: 6

   in your log.

   It also explains Deactivated: 0. The cleanup loop walks
   the same partial list, and all 20 rows it could see were
   claimed by the sheet, so it found nothing to hide.

   THE FIX

   Page through until every question is loaded.
   ============================================================ */

function fetchExistingQuestions(
  config,
  token
) {

  const headers = {

    Authorization:
      'Bearer ' + token,

  };


  const allQuestions = [];

  let page = 1;


  /*
   * 100 is the backend's maximum allowed limit.
   * Asking for more returns HTTP 400.
   */
  const PAGE_SIZE = 100;


  for (;;) {

    const url =
      config.apiBaseUrl +
      QUESTIONS_ENDPOINT +
      '?page=' + page +
      '&limit=' + PAGE_SIZE;


    const result =
      fetchJson(
        url,
        {

          method:
            'get',

          headers:
            headers,

          muteHttpExceptions:
            true,

        }
      );


    if (
      result.code !== 200
    ) {

      throw new Error(
        'GET /api/questions failed on page ' +
        page +
        '.\n\n' +

        'HTTP Status: ' +
        result.code +
        '\n\n' +

        JSON.stringify(
          result.body,
          null,
          2
        )
      );

    }


    const body =
      result.body ||
      {};


    const pageQuestions =
      Array.isArray(body)
        ? body
        : (
            Array.isArray(body.questions)
              ? body.questions
              : (
                  Array.isArray(body.data)
                    ? body.data
                    : []
                )
          );


    pageQuestions.forEach(
      function(question) {

        allQuestions.push(
          question
        );

      }
    );


    const pagination =
      body.pagination;


    /*
     * Stop when the API reports no more pages.
     *
     * The extra length check is a safety net: without it,
     * an unexpected response shape would loop forever and
     * burn the whole 6-minute execution budget.
     */
    if (
      !pagination ||
      !pagination.totalPages ||
      page >= pagination.totalPages ||
      pageQuestions.length === 0
    ) {

      break;

    }


    page++;

  }


  Logger.log(
    'Loaded ' +
    allQuestions.length +
    ' backend question(s) across ' +
    page +
    ' page(s)'
  );


  return allQuestions;

}
